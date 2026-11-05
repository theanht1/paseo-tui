import type { PaseoAgentTimelineEvent } from "@getpaseo/client";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import { expect, it } from "vitest";
import type {
  ProviderSubagentPort,
  ProviderSubagentUpdate,
} from "../connection/ports.js";
import { createProviderSubagentStore } from "./provider-subagents.js";
import { createTimelineStore } from "./timeline-store.js";

function descriptor(
  id: string,
  status: ProviderSubagentDescriptorPayload["status"] = "running",
): ProviderSubagentDescriptorPayload {
  return {
    id,
    parentAgentId: "parent",
    provider: "claude",
    title: id,
    description: null,
    status,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    toolCallId: null,
  };
}
class FakePort implements ProviderSubagentPort {
  lists: string[] = [];
  fetches: unknown[] = [];
  handler: ((update: ProviderSubagentUpdate) => void) | null = null;
  async list(parentAgentId: string) {
    this.lists.push(parentAgentId);
    return [descriptor("a")];
  }
  observe(handler: (update: ProviderSubagentUpdate) => void) {
    this.handler = handler;
    return () => {
      this.handler = null;
    };
  }
  async timeline(
    parentAgentId: string,
    subagentId: string,
    options: { direction: "tail" | "after"; limit: number },
  ) {
    this.fetches.push([parentAgentId, subagentId, options.direction]);
    return {
      epoch: "e",
      error: null,
      reset: false,
      staleCursor: false,
      gap: false,
      hasNewer: false,
      endCursor: { epoch: "e", seq: 1 },
      window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
      rows: [
        {
          seq: 1,
          timestamp: "2026-11-04T00:00:00Z",
          item: { type: "assistant_message" as const, text: "child says hi" },
        },
      ],
    };
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

it("lists a tracked parent once and applies upsert and remove updates", async () => {
  const port = new FakePort();
  const store = createProviderSubagentStore(port);
  store.track("parent");
  store.track("parent");
  await flush();
  expect(port.lists).toEqual(["parent"]);
  expect(store.getSnapshot().map((d) => d.id)).toEqual(["a"]);
  port.handler?.({ kind: "upsert", subagent: descriptor("b", "completed") });
  port.handler?.({ kind: "upsert", subagent: descriptor("a", "failed") });
  expect(store.getSnapshot().map((d) => [d.id, d.status])).toEqual([
    ["a", "failed"],
    ["b", "completed"],
  ]);
  port.handler?.({ kind: "remove", parentAgentId: "parent", subagentId: "a" });
  expect(store.getSnapshot().map((d) => d.id)).toEqual(["b"]);
  store.close();
  expect(port.handler).toBeNull();
});

it("serves a read-only child timeline with live rows to the timeline store", async () => {
  const port = new FakePort();
  const store = createProviderSubagentStore(port);
  const timeline = createTimelineStore(store.timelinePort("parent", "a"));
  await timeline.open();
  expect(timeline.getSnapshot().rows.map((row) => row.item)).toEqual([
    { type: "assistant_message", text: "child says hi" },
  ]);
  port.handler?.({
    kind: "timeline",
    parentAgentId: "parent",
    subagentId: "a",
    provider: "claude",
    item: { type: "assistant_message", text: "more" },
    timestamp: "2026-11-04T00:00:01Z",
    seq: 2,
    epoch: "e",
  });
  port.handler?.({
    kind: "timeline",
    parentAgentId: "parent",
    subagentId: "other",
    provider: "claude",
    item: { type: "assistant_message", text: "not mine" },
    timestamp: "2026-11-04T00:00:01Z",
    seq: 3,
    epoch: "e",
  });
  await flush();
  expect(timeline.getSnapshot().rows.map((row) => row.seq)).toEqual([1, 2]);
  await timeline.send("hello");
  expect(timeline.getSnapshot().lastActionError).toMatch(/read-only/);
  expect(port.fetches).toEqual([["parent", "a", "tail"]]);
  const seen: PaseoAgentTimelineEvent[] = [];
  const release = store.timelinePort("parent", "a").subscribe((event) => {
    seen.push(event);
  });
  release();
  expect(seen).toEqual([]);
});
