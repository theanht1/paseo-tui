import { expect, test } from "vitest";
import type { Stroke } from "../input/keymap.js";
import { opensSteer, steerKey, steerPaste } from "./steer.js";

function key(sequence: string, name = sequence, extra: Partial<Stroke> = {}) {
  return { name, sequence, ctrl: false, meta: false, shift: false, ...extra };
}

test("m opens the message field; modified m and other keys do not", () => {
  expect(opensSteer(key("m"))).toBe(true);
  expect(opensSteer(key("m", "m", { ctrl: true }))).toBe(false);
  expect(opensSteer(key("y"))).toBe(false);
});

test("types, edits and sends the trimmed message on Enter", () => {
  let text = "";
  for (const stroke of [key("h"), key("i"), key("x"), key("", "backspace")]) {
    const step = steerKey(text, stroke);
    if (step.kind !== "edit") throw Error(`unexpected ${step.kind}`);
    text = step.text;
  }
  expect(text).toBe("hi");
  expect(steerKey(`  ${text} `, key("\r", "return"))).toEqual({
    kind: "send",
    text: "hi",
  });
});

test("Enter with only whitespace stays open; Esc and Ctrl-C close", () => {
  expect(steerKey("  ", key("\r", "return"))).toEqual({
    kind: "edit",
    text: "  ",
  });
  expect(steerKey("draft", key("\u001b", "escape"))).toEqual({
    kind: "close",
  });
  expect(steerKey("draft", key("\u0003", "c", { ctrl: true }))).toEqual({
    kind: "close",
  });
});

test("ignores control sequences and flattens pasted newlines", () => {
  expect(steerKey("a", key("\u001b[A", "up"))).toEqual({
    kind: "edit",
    text: "a",
  });
  expect(steerPaste("a", "b\nc\r\nd")).toBe("ab c d");
});
