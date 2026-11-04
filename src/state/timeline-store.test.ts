import type { PaseoAgent, PaseoAgentTimelineEvent } from "@getpaseo/client";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import type { AgentPort, TimelineCursor, TimelinePage } from "./ports.js";
import { agent, page } from "./test-fixtures.js";
import { createTimelineStore } from "./timeline-store.js";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class FakeAgent implements AgentPort {
  handler: ((event: PaseoAgentTimelineEvent) => void) | null = null;
  ready = Promise.resolve();
  tail: TimelinePage = page([1, 2]);
  tailResult: Promise<TimelinePage> | null = null;
  afterPages: TimelinePage[] = [];
  afterCalls: TimelineCursor[] = [];
  tailCalls: number[] = [];
  current: PaseoAgent | null = agent("a");
  sent: string[] = [];
  sendError: Error | null = null;
  responded: string[] = [];
  responseResult: Promise<void> = Promise.resolve();
  cancels = 0;
  released = 0;
  subscribe(handler: (event: PaseoAgentTimelineEvent) => void) {
    this.handler = handler;
    return Object.assign(
      () => {
        this.released++;
        this.handler = null;
      },
      { ready: this.ready },
    );
  }
  async fetchTail(limit: number) {
    this.tailCalls.push(limit);
    return this.tailResult ?? this.tail;
  }
  async fetchAfter(cursor: TimelineCursor) {
    this.afterCalls.push(cursor);
    const next = this.afterPages.shift();
    if (!next) throw new Error("No catch-up page");
    return next;
  }
  async send(text: string) {
    if (this.sendError) throw this.sendError;
    this.sent.push(text);
  }
  async respondToPermission(id: string, _response: AgentPermissionResponse) {
    await this.responseResult;
    this.responded.push(id);
  }
  async cancel() {
    this.cancels++;
  }
  snapshot() {
    return this.current;
  }
  push(event: PaseoAgentTimelineEvent) {
    this.handler?.(event);
  }
  timeline(seq: number, epoch = "epoch") {
    this.push({
      agentId: "a",
      epoch,
      seq,
      timestamp: "2026-11-03T00:00:00Z",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text: String(seq) },
      },
    });
  }
}
const permission: AgentPermissionRequest = {
  id: "p",
  name: "write",
  kind: "tool",
  provider: "codex",
};
async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function sequences(store: ReturnType<typeof createTimelineStore>) {
  return store.getSnapshot().rows.map((row) => row.seq);
}

describe("timeline store", () => {
  it("preserves the turn failure message when an attention event follows", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "turn_failed",
        provider: "codex",
        error: "Provider rejected the request",
      },
    });
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "attention_required",
        provider: "codex",
        reason: "error",
        timestamp: "now",
        shouldNotify: true,
      },
    });
    await settle();
    expect(store.getSnapshot().turn).toEqual({
      kind: "failed",
      message: "Provider rejected the request",
    });
  });

  it("loads history then appends live rows, keeping a stable snapshot between updates", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    expect(port.tailCalls).toEqual([200]);
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    port.timeline(3);
    await settle();
    expect(sequences(store)).toEqual([1, 2, 3]);
  });
  it("subscribes before ready and buffers live rows during fetch, deduping history", async () => {
    const port = new FakeAgent();
    const ready = deferred<void>();
    const tail = deferred<TimelinePage>();
    port.ready = ready.promise;
    port.tailResult = tail.promise;
    const store = createTimelineStore(port);
    const opened = store.open();
    expect(port.handler).not.toBeNull();
    expect(port.tailCalls).toEqual([]);
    port.timeline(2);
    ready.resolve();
    await settle();
    expect(port.tailCalls).toEqual([200]);
    port.timeline(3);
    tail.resolve(page([1, 2]));
    await opened;
    expect(sequences(store)).toEqual([1, 2, 3]);
  });
  it("drops duplicate and stale sequences", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    const before = store.getSnapshot();
    port.timeline(2);
    port.timeline(1);
    await settle();
    expect(store.getSnapshot()).toBe(before);
    expect(port.afterCalls).toEqual([]);
  });
  it("fills a gap in order and dedupes the triggering event", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    port.afterPages = [page([3, 4], { direction: "after" })];
    await store.open();
    port.timeline(4);
    port.timeline(5);
    await settle();
    expect(port.afterCalls).toEqual([{ epoch: "epoch", seq: 2 }]);
    expect(sequences(store)).toEqual([1, 2, 3, 4, 5]);
  });
  it("paginates catch-up without skipping rows", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    port.afterPages = [
      page([3], {
        direction: "after",
        hasNewer: true,
        window: { minSeq: 1, maxSeq: 5, nextSeq: 6 },
      }),
      page([4, 5], { direction: "after" }),
    ];
    await store.open();
    port.timeline(5);
    await settle();
    expect(port.afterCalls.map((c) => c.seq)).toEqual([2, 3]);
    expect(sequences(store)).toEqual([1, 2, 3, 4, 5]);
  });
  it.each(["replacement", "epoch mismatch"])(
    "resets rows on %s",
    async (kind) => {
      const port = new FakeAgent();
      const store = createTimelineStore(port);
      await store.open();
      port.tail = page([1], { epoch: "new" });
      if (kind === "replacement")
        port.push({
          agentId: "a",
          event: { type: "replacement", epoch: "new" },
        });
      else port.timeline(1, "new");
      await settle();
      expect(store.getSnapshot().epoch).toBe("new");
      expect(sequences(store)).toEqual([1]);
      expect(port.tailCalls).toEqual([200, 200]);
    },
  );
  it("catches up after subscription restoration", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    port.afterPages = [page([3, 4], { direction: "after" })];
    await store.open();
    port.push({
      agentId: "a",
      subscriptionId: "restored",
      event: { type: "subscription_restored" },
    });
    await settle();
    expect(port.afterCalls).toEqual([{ epoch: "epoch", seq: 2 }]);
    expect(sequences(store)).toEqual([1, 2, 3, 4]);
  });
  it("seeds permissions, adds requests once, and removes resolved requests", async () => {
    const port = new FakeAgent();
    port.current = agent("a", { pendingPermissions: [permission] });
    const store = createTimelineStore(port);
    await store.open();
    expect(store.getSnapshot().pendingPermissions).toEqual([permission]);
    const second = { ...permission, id: "second" };
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "permission_requested",
        provider: "codex",
        request: second,
      },
    });
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "permission_requested",
        provider: "codex",
        request: second,
      },
    });
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "permission_resolved",
        provider: "codex",
        requestId: "p",
        resolution: { behavior: "allow" },
      },
    });
    await settle();
    expect(store.getSnapshot().pendingPermissions).toEqual([second]);
  });
  it("reseeds permissions from authoritative refetch snapshots", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    port.tail = page([1], {
      agent: agent("a", { pendingPermissions: [permission] }),
    });
    port.push({ agentId: "a", event: { type: "replacement", epoch: "epoch" } });
    await settle();
    expect(store.getSnapshot().pendingPermissions).toEqual([permission]);
    port.tail = page([1], { agent: agent("a") });
    port.push({ agentId: "a", event: { type: "replacement", epoch: "epoch" } });
    await settle();
    expect(store.getSnapshot().pendingPermissions).toEqual([]);
  });
  it("ignores future stream events and preserves unknown timeline items", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    const before = store.getSnapshot();
    if (!port.handler) throw new Error("Missing subscription");
    Reflect.apply(port.handler, undefined, [
      { agentId: "a", event: { type: "future_event" } },
    ]);
    await settle();
    expect(store.getSnapshot()).toBe(before);
    const item = { type: "future_item", extra: 1 };
    Reflect.apply(port.handler, undefined, [
      {
        agentId: "a",
        epoch: "epoch",
        seq: 3,
        timestamp: "now",
        event: { type: "timeline", provider: "codex", item },
      },
    ]);
    await settle();
    expect(store.getSnapshot().rows.at(-1)?.item).toEqual(item);
  });
  it("caps rows at the latest 500 without losing its sequence cursor", async () => {
    const port = new FakeAgent();
    port.tail = page(Array.from({ length: 500 }, (_, i) => i + 1));
    const store = createTimelineStore(port);
    await store.open();
    port.timeline(501);
    await settle();
    expect(store.getSnapshot().rows).toHaveLength(500);
    expect(sequences(store)[0]).toBe(2);
    expect(sequences(store).at(-1)).toBe(501);
  });
  it("trims sends, ignores empty input, waits for daemon echo, and reports failures", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    await store.send("  ");
    await store.send(" hello ");
    expect(port.sent).toEqual(["hello"]);
    expect(sequences(store)).toEqual([1, 2]);
    port.sendError = new Error("offline");
    await store.send("fail");
    expect(store.getSnapshot().lastActionError).toBe("offline");
    port.sendError = null;
    await store.send("retry");
    expect(store.getSnapshot().lastActionError).toBeNull();
  });
  it("removes a permission only after a successful response and records action errors", async () => {
    const port = new FakeAgent();
    port.current = agent("a", { pendingPermissions: [permission] });
    const store = createTimelineStore(port);
    await store.open();
    const response = deferred<void>();
    port.responseResult = response.promise;
    const responding = store.respond("p", { behavior: "allow" });
    expect(store.getSnapshot().pendingPermissions).toEqual([permission]);
    response.resolve();
    await responding;
    expect(store.getSnapshot().pendingPermissions).toEqual([]);
    port.responseResult = Promise.reject(new Error("denied"));
    await store.respond("p", { behavior: "deny" });
    expect(store.getSnapshot().lastActionError).toBe("denied");
    await store.cancel();
    expect(port.cancels).toBe(1);
  });
  it("tracks turn start, failure, completion, cancel, and attention", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    port.push({
      agentId: "a",
      timestamp: "now",
      event: { type: "turn_started", provider: "codex", turnId: "turn" },
    });
    await settle();
    expect(store.getSnapshot().turn).toEqual({
      kind: "running",
      turnId: "turn",
    });
    port.push({
      agentId: "a",
      timestamp: "now",
      event: { type: "turn_failed", provider: "codex", error: "failed" },
    });
    await settle();
    expect(store.getSnapshot().turn).toEqual({
      kind: "failed",
      message: "failed",
    });
    const endings: Extract<
      PaseoAgentTimelineEvent,
      { timestamp: string }
    >["event"][] = [
      { type: "turn_completed", provider: "codex" },
      { type: "turn_canceled", provider: "codex", reason: "stop" },
    ];
    for (const event of endings) {
      port.push({ agentId: "a", timestamp: "now", event });
      await settle();
      expect(store.getSnapshot().turn).toEqual({ kind: "idle" });
    }
    port.push({
      agentId: "a",
      timestamp: "now",
      event: {
        type: "attention_required",
        provider: "codex",
        reason: "error",
        timestamp: "now",
        shouldNotify: true,
      },
    });
    await settle();
    expect(store.getSnapshot().turn.kind).toBe("failed");
  });
  it("surfaces subscription errors and releases the stream", async () => {
    const port = new FakeAgent();
    const store = createTimelineStore(port);
    await store.open();
    port.push({
      agentId: "a",
      event: { type: "error", error: "lost subscription" },
    });
    await settle();
    expect(store.getSnapshot().error).toBe("lost subscription");
    expect(port.released).toBe(1);
  });
  it("close during a fetch discards its result and drops listeners", async () => {
    const port = new FakeAgent();
    const tail = deferred<TimelinePage>();
    port.tailResult = tail.promise;
    const store = createTimelineStore(port);
    let changes = 0;
    store.subscribe(() => changes++);
    const opened = store.open();
    await settle();
    store.close();
    const count = changes;
    tail.resolve(page([1, 2]));
    await opened;
    expect(store.getSnapshot().rows).toEqual([]);
    expect(changes).toBe(count);
    expect(port.released).toBe(1);
  });
});
