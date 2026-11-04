import { expect, test } from "vitest";
import type { Block } from "./blocks.js";
import { findMatches, nextMatch } from "./search.js";

test("case insensitive matches retain block order and wrap in both directions", () => {
  const blocks: Block[] = [
    { kind: "user", key: "a", text: "Needle" },
    { kind: "assistant", key: "b", text: "no" },
    { kind: "reasoning", key: "c", text: "needle inside" },
  ];
  expect(findMatches(blocks, "NEEDLE")).toEqual(["a", "c"]);
  expect(findMatches(blocks, "")).toEqual([]);
  expect(nextMatch(["a", "c"], "c", 1)).toBe("a");
  expect(nextMatch(["a", "c"], "a", -1)).toBe("c");
  expect(nextMatch([], null, 1)).toBeNull();
});
test("finds hidden tool output", () => {
  const blocks: Block[] = [
    {
      kind: "tool",
      key: "t",
      call: {
        type: "tool_call",
        callId: "c",
        name: "shell",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "ls", output: "secret needle" },
      },
    },
  ];
  expect(findMatches(blocks, "secret needle")).toEqual(["t"]);
});
