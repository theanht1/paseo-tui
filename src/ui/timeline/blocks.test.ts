import { expect, test } from "vitest";
import { at } from "../../test/at.js";
import { blockText, toBlocks } from "./blocks.js";

function rows(...items: Parameters<typeof toBlocks>[0][number]["item"][]) {
  return items.map((item, seq) => ({ seq: seq + 1, item }));
}
test("merges assistant chunks, preserves boundaries and stable keys", () => {
  const input = rows(
    { type: "assistant_message", text: "hel" },
    { type: "assistant_message", text: "lo" },
  );
  expect(toBlocks(input)).toEqual([
    { kind: "assistant", key: "assistant:1", text: "hello" },
  ]);
  expect(
    toBlocks([
      ...input,
      ...rows(
        { type: "user_message", text: "next" },
        { type: "assistant_message", text: "reply" },
      ),
    ]).map(blockText),
  ).toEqual(["hello", "next", "reply"]);
  expect(at(toBlocks(input.slice(0, 1)), 0).key).toBe(
    at(toBlocks(input), 0).key,
  );
});
test("merges reasoning and leaves wide text to the renderer", () => {
  expect(
    toBlocks(
      rows(
        { type: "reasoning", text: "think" },
        { type: "reasoning", text: " more" },
        { type: "assistant_message", text: "ab界cd界ef" },
      ),
    ),
  ).toEqual([
    { kind: "reasoning", key: "reasoning:1", text: "think more" },
    { kind: "assistant", key: "assistant:3", text: "ab界cd界ef" },
  ]);
});
test("latest tool stays at first position, even across message chunks", () => {
  const a = {
    type: "tool_call",
    callId: "a",
    name: "read",
    status: "running",
    error: null,
    detail: { type: "plain_text", text: "file.ts" },
  } as const;
  const b = { ...a, callId: "b" };
  const latest = { ...a, status: "completed" } as const;
  expect(
    toBlocks(
      rows(a, b, { type: "assistant_message", text: "hel" }, latest, {
        type: "assistant_message",
        text: "lo",
      }),
    ),
  ).toEqual([
    { kind: "tool", key: "tool:a", call: latest },
    { kind: "tool", key: "tool:b", call: b },
    { kind: "assistant", key: "assistant:3", text: "hello" },
  ]);
});
test("unknown types and all other variants remain readable", () => {
  const blocks = toBlocks(
    rows(
      { type: "future_timeline" },
      { type: "future_stream" },
      { type: "todo", items: [{ text: "task", completed: true }] },
      { type: "error", message: "failed" },
      { type: "notification", level: "info", message: "notice" },
      { type: "compaction", status: "completed" },
      {
        type: "plugin",
        id: "p",
        pluginId: "p",
        kind: "x",
        version: 1,
        data: null,
      },
    ),
  );
  expect(blocks.map((b) => b.kind)).toEqual([
    "unknown",
    "unknown",
    "todo",
    "error",
    "notice",
    "notice",
    "notice",
  ]);
  expect(blocks.map(blockText)).toEqual([
    "[future_timeline]",
    "[future_stream]",
    "task",
    "failed",
    "notice",
    "compaction completed",
    "[plugin]",
  ]);
});
test("plans keep their proposal position and show the daemon's outcome", () => {
  const proposal = {
    type: "tool_call",
    callId: "plan-1",
    name: "ExitPlanMode",
    status: "running",
    error: null,
    detail: { type: "plan", text: "# Steps\n1. Edit README" },
  } as const;
  const rejected = {
    ...proposal,
    name: "plan_approval",
    status: "completed",
    metadata: { approved: false },
  } as const;
  // The approval card owns a pending plan; the timeline hides it until it resolves.
  expect(toBlocks(rows(proposal))).toEqual([]);
  const resolved = toBlocks(
    rows(proposal, { type: "user_message", text: "do X instead" }, rejected),
  );
  expect(resolved).toEqual([
    {
      kind: "plan",
      key: "plan:plan-1",
      outcome: "rejected",
      text: "# Steps\n1. Edit README",
    },
    { kind: "user", key: "user:2", text: "do X instead" },
  ]);
  expect(blockText(at(resolved, 0))).toBe(
    "Rejected plan\n# Steps\n1. Edit README",
  );
  expect(
    toBlocks(
      rows(
        { ...rejected, callId: "a", metadata: { approved: true } },
        { ...rejected, callId: "b", status: "canceled", metadata: {} },
        { ...rejected, callId: "c", metadata: {} },
      ),
    ).map((b) => (b.kind === "plan" ? b.outcome : b.kind)),
  ).toEqual(["approved", "canceled", "proposed"]);
});
