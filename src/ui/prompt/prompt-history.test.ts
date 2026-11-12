import { expect, test } from "vitest";
import type { TimelineRow } from "../../state/timeline-store.js";
import { recall, START, sentPrompts } from "./prompt-history.js";

function row(seq: number, item: TimelineRow["item"]): TimelineRow {
  return { seq, timestamp: "2026-11-10T00:00:00Z", item };
}

test("lists sent prompts newest first, without repeats in a row or blanks", () => {
  expect(
    sentPrompts([
      row(1, { type: "user_message", text: "first" }),
      row(2, { type: "assistant_message", text: "reply" }),
      row(3, { type: "user_message", text: "again" }),
      row(4, { type: "user_message", text: "again" }),
      row(5, { type: "user_message", text: "  " }),
      row(6, { type: "user_message", text: "last" }),
    ]),
  ).toEqual(["last", "again", "first"]);
});

test("walks to older prompts and back to newer ones, then to an empty input", () => {
  const entries = ["last", "middle", "first"];
  const one = recall(entries, START, "", "older");
  expect(one?.text).toBe("last");
  const two = recall(entries, one?.state ?? START, "last", "older");
  expect(two?.text).toBe("middle");
  const three = recall(entries, two?.state ?? START, "middle", "older");
  expect(three?.text).toBe("first");
  expect(recall(entries, three?.state ?? START, "first", "older")).toBeNull();
  const back = recall(entries, three?.state ?? START, "first", "newer");
  expect(back?.text).toBe("middle");
  const newest = recall(entries, back?.state ?? START, "middle", "newer");
  const cleared = recall(entries, newest?.state ?? START, "last", "newer");
  expect(cleared).toEqual({ state: START, text: "" });
  expect(recall(entries, START, "", "newer")).toBeNull();
});

test("leaves a dirty input to the cursor keys", () => {
  const entries = ["last", "first"];
  expect(recall(entries, START, "new text", "older")).toBeNull();
  const shown = recall(entries, START, "", "older");
  expect(recall(entries, shown?.state ?? START, "last edited", "older")).toBe(
    null,
  );
  expect(
    recall(entries, shown?.state ?? START, "last edited", "newer"),
  ).toBeNull();
});

test("starts over from the newest prompt once the input is emptied", () => {
  const entries = ["last", "first"];
  const shown = recall(entries, START, "", "older");
  const older = recall(entries, shown?.state ?? START, "last", "older");
  expect(recall(entries, older?.state ?? START, "", "older")?.text).toBe(
    "last",
  );
  expect(recall([], START, "", "older")).toBeNull();
});
