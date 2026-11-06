import type { PaseoAgentTimelineEvent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { agent, page } from "../test/fixtures.js";
import { createMessageQueues } from "./message-queue.js";
import type { AgentPort } from "./ports.js";
import { createTimelineRegistry } from "./timeline-registry.js";
import { createTimelineStore } from "./timeline-store.js";

class FakePort implements AgentPort {
  handler: ((event: PaseoAgentTimelineEvent) => void) | null = null;
  calls: string[] = [];
  sendError: Error | null = null;
  constructor(readonly status: "running" | "idle" = "running") {}
  fetchTail = async () => page([]);
  fetchAfter = async () => page([]);
  subscribe(handler: (event: PaseoAgentTimelineEvent) => void) {
    this.handler = handler;
    return Object.assign(() => {}, { ready: Promise.resolve() });
  }
  async send(text: string) {
    this.calls.push(`send ${text}`);
    if (this.sendError) throw this.sendError;
  }
  async steer(text: string) {
    this.calls.push(`steer ${text}`);
  }
  async interrupt(text: string) {
    this.calls.push(`interrupt ${text}`);
  }
  respondToPermission = async () => {};
  setMode = async () => null;
  setModel = async () => {};
  rename = async () => {};
  archive = async () => {};
  async cancel() {
    this.calls.push("cancel");
  }
  snapshot() {
    return agent("a", { status: this.status });
  }
  turn(
    event:
      | { type: "turn_started"; turnId: string }
      | { type: "turn_completed" }
      | { type: "turn_canceled"; reason: string }
      | { type: "turn_failed"; error: string },
  ) {
    this.handler?.({
      agentId: "a",
      timestamp: "now",
      event: { ...event, provider: "codex" },
    });
  }
}
async function settle() {
  for (let i = 0; i < 5; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}
async function setup(status: "running" | "idle" = "running") {
  const port = new FakePort(status);
  const opened: FakePort[] = [];
  const registry = createTimelineRegistry(() => {
    opened.push(port);
    return createTimelineStore(port);
  });
  const queues = createMessageQueues(registry);
  const queue = queues.forAgent(agent("a"));
  await settle();
  return { port, registry, queues, queue, opened };
}
function texts(queue: {
  getSnapshot(): { items: readonly { text: string }[] };
}) {
  return queue.getSnapshot().items.map((item) => item.text);
}

describe("message queue", () => {
  it("holds messages while the turn runs and sends the oldest at each turn end", async () => {
    const { port, queue, queues } = await setup();
    queue.enqueue("first");
    queue.enqueue("second");
    await settle();
    expect(port.calls).toEqual([]);
    expect(queues.total()).toBe(2);
    port.turn({ type: "turn_completed" });
    await settle();
    expect(port.calls).toEqual(["send first"]);
    expect(texts(queue)).toEqual(["second"]);
    port.turn({ type: "turn_started", turnId: "t2" });
    await settle();
    expect(port.calls).toEqual(["send first"]);
    port.turn({ type: "turn_completed" });
    await settle();
    expect(port.calls).toEqual(["send first", "send second"]);
    expect(queues.total()).toBe(0);
  });
  it("keeps the agent's timeline open while messages wait, and lets it go once empty", async () => {
    const { port, queue, registry, opened } = await setup();
    queue.enqueue("later");
    const pane = registry.acquire(agent("a"));
    pane.release();
    port.turn({ type: "turn_completed" });
    await settle();
    expect(port.calls).toEqual(["send later"]);
    expect(opened).toHaveLength(1);
    registry.acquire(agent("a"));
    expect(opened).toHaveLength(2);
  });
  it("takes a message out for editing and removes one", async () => {
    const { queue } = await setup();
    queue.enqueue("one");
    queue.enqueue("two");
    queue.enqueue("three");
    const [one, two] = queue.getSnapshot().items;
    expect(queue.take(two?.id ?? "")).toBe("two");
    queue.remove(one?.id ?? "");
    expect(texts(queue)).toEqual(["three"]);
    expect(queue.take("missing")).toBeNull();
    queue.clear();
    expect(texts(queue)).toEqual([]);
  });
  it("sends a message now into the running turn, or interrupts it", async () => {
    const { port, queue } = await setup();
    queue.enqueue("steer me");
    queue.enqueue("cut in");
    const [steer, cut] = queue.getSnapshot().items;
    await queue.sendNow(steer?.id ?? "", "steer");
    await queue.sendNow(cut?.id ?? "", "interrupt");
    expect(port.calls).toEqual(["steer steer me", "interrupt cut in"]);
    expect(texts(queue)).toEqual([]);
  });
  it("pauses after a failed or stopped turn instead of sending into it, until resumed", async () => {
    const { port, queue } = await setup();
    queue.enqueue("after failure");
    port.turn({ type: "turn_failed", error: "boom" });
    await settle();
    expect(port.calls).toEqual([]);
    expect(queue.getSnapshot().paused).toBe(true);
    await queue.resume();
    expect(port.calls).toEqual(["send after failure"]);
    expect(queue.getSnapshot().paused).toBe(false);
  });
  it("pauses when the user stopped the turn", async () => {
    const { port, queue, registry } = await setup();
    queue.enqueue("after stop");
    const hold = registry.acquire(agent("a"));
    await hold.store.stop();
    port.turn({ type: "turn_canceled", reason: "stop" });
    await settle();
    expect(port.calls).toEqual(["cancel"]);
    expect(queue.getSnapshot().paused).toBe(true);
    hold.release();
  });
  it("puts a message back and pauses when sending it fails", async () => {
    const { port, queue } = await setup();
    queue.enqueue("flaky");
    port.sendError = Error("offline");
    port.turn({ type: "turn_completed" });
    await settle();
    expect(texts(queue)).toEqual(["flaky"]);
    expect(queue.getSnapshot().paused).toBe(true);
  });
});
