import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import {
  agentIndicator,
  createAttentionTracker,
  groupIndicator,
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
