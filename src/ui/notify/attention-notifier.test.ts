import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { createAttentionNotifier } from "./attention-notifier.js";

const none = new Set<string>();
const tool = {
  id: "t1",
  provider: "codex",
  name: "Bash",
  kind: "tool" as const,
};
const question = {
  id: "q1",
  provider: "codex",
  name: "AskUserQuestion",
  kind: "question" as const,
};
const shown = () => false;

it("stays quiet for what was already waiting at startup", () => {
  const notifier = createAttentionNotifier();
  expect(
    notifier.update([agent("a", { pendingPermissions: [tool] })], none, shown),
  ).toEqual([]);
  expect(
    notifier.update([agent("a", { pendingPermissions: [tool] })], none, shown),
  ).toEqual([]);
});

it("notifies once per new question, permission, finished, or failed turn", () => {
  const notifier = createAttentionNotifier();
  notifier.update(
    [agent("a", { title: "Alpha", status: "running" })],
    none,
    shown,
  );
  expect(
    notifier.update(
      [agent("a", { title: "Alpha", pendingPermissions: [question] })],
      none,
      shown,
    ),
  ).toEqual([{ agentId: "a", title: "Alpha", body: "Has a question for you" }]);
  expect(
    notifier.update(
      [agent("a", { title: "Alpha", pendingPermissions: [tool] })],
      none,
      shown,
    ),
  ).toEqual([{ agentId: "a", title: "Alpha", body: "Needs permission: Bash" }]);
  const done = {
    title: "Alpha",
    requiresAttention: true,
    attentionReason: "finished" as const,
    attentionTimestamp: "2026-11-04T00:00:01Z",
  };
  expect(notifier.update([agent("a", done)], none, shown)).toEqual([
    { agentId: "a", title: "Alpha", body: "Finished" },
  ]);
  expect(notifier.update([agent("a", done)], none, shown)).toEqual([]);
  expect(
    notifier.update(
      [
        agent("a", {
          ...done,
          attentionReason: "error",
          attentionTimestamp: "2026-11-04T00:00:02Z",
        }),
      ],
      none,
      shown,
    ),
  ).toEqual([{ agentId: "a", title: "Alpha", body: "Failed" }]);
});

it("skips the agent you are looking at but announces new agents that start out waiting", () => {
  const notifier = createAttentionNotifier();
  notifier.update([agent("a", { status: "running" })], none, shown);
  expect(
    notifier.update(
      [agent("a", { pendingPermissions: [tool] })],
      none,
      (id) => id === "a",
    ),
  ).toEqual([]);
  expect(
    notifier.update(
      [
        agent("a", { pendingPermissions: [tool] }),
        agent("new", { pendingPermissions: [tool] }),
      ],
      none,
      shown,
    ),
  ).toEqual([{ agentId: "new", title: "new", body: "Needs permission: Bash" }]);
});
