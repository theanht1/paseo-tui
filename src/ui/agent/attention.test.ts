import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import {
  agentIndicator,
  attentionQueue,
  createAttentionTracker,
  groupIndicator,
  indicatorBucket,
  nextAttention,
  workspaceBucket,
} from "./attention.js";

const finished = agent("done", {
  requiresAttention: true,
  attentionReason: "finished",
  attentionTimestamp: "2026-11-04T00:00:01Z",
});

it("marks running agents as working and unviewed finished or failed turns as unread", () => {
  const none = new Set<string>();
  expect(agentIndicator(agent("busy", { status: "running" }), none)).toEqual({
    kind: "working",
  });
  expect(agentIndicator(finished, none)).toEqual({
    kind: "unread",
    reason: "finished",
  });
  expect(
    agentIndicator(
      agent("failed", { requiresAttention: true, attentionReason: "error" }),
      none,
    ),
  ).toEqual({ kind: "unread", reason: "error" });
  expect(
    agentIndicator(
      agent("asks", {
        requiresAttention: true,
        attentionReason: "permission",
      }),
      none,
    ),
  ).toEqual({ kind: "permission" });
  expect(agentIndicator(agent("idle"), none)).toEqual({ kind: "none" });
});

it("summarizes a workspace as working before unread", () => {
  const none = new Set<string>();
  expect(groupIndicator([agent("idle"), finished], none)).toEqual({
    kind: "unread",
    reason: "finished",
  });
  expect(
    groupIndicator(
      [finished, agent("busy", { status: "running" }), agent("idle")],
      none,
    ),
  ).toEqual({ kind: "working" });
  expect(groupIndicator([agent("idle")], none)).toEqual({ kind: "none" });
});

it("clears a viewed finished turn once and shows the next finished turn again", async () => {
  const cleared: string[] = [];
  const tracker = createAttentionTracker(async (id) => {
    cleared.push(id);
  });
  tracker.view(agent("idle"));
  tracker.view(finished);
  tracker.view(finished);
  expect(cleared).toEqual(["done"]);
  expect(agentIndicator(finished, tracker.getSnapshot())).toEqual({
    kind: "none",
  });
  const later = { ...finished, attentionTimestamp: "2026-11-04T00:00:09Z" };
  expect(agentIndicator(later, tracker.getSnapshot()).kind).toBe("unread");
  tracker.view(later);
  expect(cleared).toEqual(["done", "done"]);
});

const idle = {
  ...finished,
  requiresAttention: false,
  attentionTimestamp: "2026-11-03T00:00:00Z",
};
it("keeps the marked turn unread while viewed, but acknowledges a later turn", () => {
  const cleared: string[] = [];
  const tracker = createAttentionTracker(async (id) => {
    cleared.push(id);
  });
  tracker.hold(idle);
  tracker.view(finished);
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("unread");
  tracker.view(finished);
  expect(cleared).toEqual([]);
  const later = { ...finished, attentionTimestamp: "2026-11-04T00:00:09Z" };
  tracker.view(later);
  expect(agentIndicator(later, tracker.getSnapshot()).kind).toBe("none");
  expect(cleared).toEqual(["done"]);
});

it("acknowledges the marked turn once the agent is viewed again", () => {
  const tracker = createAttentionTracker(async () => {});
  tracker.hold(idle);
  tracker.view(finished);
  tracker.view(null);
  tracker.view(finished);
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("none");
});

it("stops holding once the mark settles if no new turn reached the viewed agent", () => {
  const tracker = createAttentionTracker(async () => {});
  tracker.hold(idle);
  tracker.settle();
  tracker.view(finished);
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("none");
});

it("keeps a pinned mark through settle", () => {
  const tracker = createAttentionTracker(async () => {});
  tracker.hold(idle);
  tracker.view(finished);
  tracker.settle();
  tracker.view(finished);
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("unread");
});

it("stops holding when the mark settles without the viewed agent changing", () => {
  const tracker = createAttentionTracker(async () => {});
  tracker.hold(idle);
  tracker.release();
  tracker.view(finished);
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("none");
});

it("keeps a viewed turn read locally when the daemon rejects the clear", async () => {
  const tracker = createAttentionTracker(async () => {
    throw Error("offline");
  });
  tracker.view(finished);
  await new Promise((resolve) => setImmediate(resolve));
  expect(agentIndicator(finished, tracker.getSnapshot()).kind).toBe("none");
});

function request(kind: "question" | "tool", id = kind) {
  return { id, provider: "codex", name: kind, kind };
}
it("ranks question > permission > working > unread error > unread finished", () => {
  const none = new Set<string>();
  const asking = agent("asking", {
    status: "running",
    pendingPermissions: [request("tool"), request("question")],
  });
  const permitting = agent("permitting", {
    status: "running",
    pendingPermissions: [request("tool")],
  });
  const flagged = agent("flagged", {
    requiresAttention: true,
    attentionReason: "permission",
  });
  const busy = agent("busy", { status: "running" });
  const failed = agent("failed", {
    requiresAttention: true,
    attentionReason: "error",
  });
  expect(agentIndicator(asking, none)).toEqual({ kind: "question" });
  expect(agentIndicator(permitting, none)).toEqual({ kind: "permission" });
  expect(agentIndicator(flagged, none)).toEqual({ kind: "permission" });
  expect(groupIndicator([finished, failed], none)).toEqual({
    kind: "unread",
    reason: "error",
  });
  expect(groupIndicator([finished, failed, busy], none)).toEqual({
    kind: "working",
  });
  expect(groupIndicator([busy, flagged], none)).toEqual({
    kind: "permission",
  });
  expect(groupIndicator([permitting, asking, busy], none)).toEqual({
    kind: "question",
  });
});

it("buckets indicators act-first: needs input, failed, running, unread, idle", () => {
  expect(indicatorBucket({ kind: "question" })).toBe("needs_input");
  expect(indicatorBucket({ kind: "permission" })).toBe("needs_input");
  expect(indicatorBucket({ kind: "unread", reason: "error" })).toBe("failed");
  expect(indicatorBucket({ kind: "working" })).toBe("running");
  expect(indicatorBucket({ kind: "unread", reason: "finished" })).toBe(
    "attention",
  );
  expect(indicatorBucket({ kind: "none" })).toBe("done");
  const none = new Set<string>();
  const failed = agent("failed", {
    requiresAttention: true,
    attentionReason: "error",
  });
  expect(
    workspaceBucket([agent("busy", { status: "running" }), failed], none),
  ).toBe("failed");
  expect(workspaceBucket([], none)).toBe("done");
});

it("queues agents that need you by urgency then recency and cycles past the current one", () => {
  const none = new Set<string>();
  const older = agent("older", {
    ...finished,
    id: "older",
    attentionTimestamp: "2026-11-04T00:00:00Z",
  });
  const asking = agent("asking", { pendingPermissions: [request("tool")] });
  const failed = agent("failed", {
    requiresAttention: true,
    attentionReason: "error",
    attentionTimestamp: "2026-11-04T00:00:00Z",
  });
  const archived = agent("archived", {
    pendingPermissions: [request("tool")],
    archivedAt: "2026-11-04T00:00:00Z",
  });
  const queue = attentionQueue(
    [
      older,
      agent("busy", { status: "running" }),
      finished,
      failed,
      asking,
      archived,
    ],
    none,
  );
  expect(queue.map((entry) => entry.id)).toEqual([
    "asking",
    "failed",
    "done",
    "older",
  ]);
  expect(nextAttention(queue, null)?.id).toBe("asking");
  expect(nextAttention(queue, "busy")?.id).toBe("asking");
  expect(nextAttention(queue, "failed")?.id).toBe("done");
  expect(nextAttention(queue, "older")?.id).toBe("asking");
  expect(nextAttention([], "older")).toBeNull();
  expect(
    attentionQueue(
      [finished],
      new Set([`done@${finished.attentionTimestamp}`]),
    ),
  ).toEqual([]);
});
