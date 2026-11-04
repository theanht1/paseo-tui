import { expect, test } from "vitest";
import { toBlocks } from "./blocks.js";
import { setAll, toggle } from "./expansion.js";

test("toggle is immutable and reversible", () => {
  const s = new Set<string>();
  const t = toggle(s, "a");
  expect([...t]).toEqual(["a"]);
  expect(s.size).toBe(0);
  expect(toggle(t, "a").size).toBe(0);
});
test("all expands only tools and reasoning, or collapses", () => {
  const b = toBlocks([
    { seq: 1, item: { type: "reasoning", text: "x" } },
    { seq: 2, item: { type: "user_message", text: "y" } },
  ]);
  expect([...setAll(b, true)]).toEqual(["reasoning:1"]);
  expect(setAll(b, false).size).toBe(0);
});
