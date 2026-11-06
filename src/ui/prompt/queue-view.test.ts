import { describe, expect, it } from "vitest";
import { BINDINGS } from "../input/bindings.js";
import { shortcutFor } from "../input/keymap.js";
import {
  moveSelection,
  queueHint,
  queueRows,
  targetItem,
} from "./queue-view.js";

const items = ["first", "second\nmore lines", "third", "fourth", "fifth"].map(
  (text, index) => ({ id: `q${index + 1}`, text }),
);

describe("queue rows", () => {
  it("lists up to three first lines and counts the rest", () => {
    expect(queueRows(items, null)).toEqual({
      rows: [
        { id: "q1", label: "⧗ 1. first", selected: false },
        { id: "q2", label: "⧗ 2. second …", selected: false },
        { id: "q3", label: "⧗ 3. third", selected: false },
      ],
      more: 2,
    });
  });
  it("scrolls the window to keep the selection visible", () => {
    const view = queueRows(items, "q5");
    expect(view.rows.map((row) => row.id)).toEqual(["q3", "q4", "q5"]);
    expect(view.rows.at(-1)?.selected).toBe(true);
    expect(view.more).toBe(2);
  });
});

describe("queue selection", () => {
  it("starts at the newest going up and the oldest going down, and stops at the ends", () => {
    expect(moveSelection(items, null, -1)).toBe("q5");
    expect(moveSelection(items, null, 1)).toBe("q1");
    expect(moveSelection(items, "q1", -1)).toBe("q1");
    expect(moveSelection(items, "q2", 1)).toBe("q3");
    expect(moveSelection(items, "q5", 1)).toBe("q5");
    expect(moveSelection([], null, 1)).toBeNull();
  });
  it("acts on the selected message, else the oldest", () => {
    expect(targetItem(items, "q3")?.text).toBe("third");
    expect(targetItem(items, null)?.text).toBe("first");
    expect(targetItem(items, "gone")?.text).toBe("first");
    expect(targetItem([], null)).toBeNull();
  });
});

describe("queue hint", () => {
  const label = (action: Parameters<typeof shortcutFor>[0]) =>
    shortcutFor(action, BINDINGS, "Ctrl-B");
  it("names the queue keys from the effective bindings, or how to resume", () => {
    expect(queueHint(false, null, label)).toBe(
      "Ctrl-S send now · Ctrl-R edit · Ctrl-O remove · Ctrl-Up Ctrl-Down select",
    );
    expect(queueHint(true, null, label)).toBe("Queue paused · Enter to resume");
    expect(queueHint(false, "q2", label)).toBe(
      "Ctrl-O again removes this multi-line message",
    );
  });
});
