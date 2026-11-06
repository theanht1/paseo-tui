import { describe, expect, it } from "vitest";
import { findPathMentions } from "./detect.js";
import { assignHints, hintKey, hintLabels, screenSpots } from "./hints.js";

describe("hintLabels", () => {
  it("uses home-row letters first, then prefix-free two-letter labels", () => {
    expect(hintLabels(4)).toEqual(["a", "s", "d", "f"]);
    expect(hintLabels(8)).toEqual(["a", "s", "d", "f", "j", "k", "l", ";"]);
    const many = hintLabels(40);
    expect(many).toHaveLength(40);
    expect(new Set(many).size).toBe(40);
    expect(many.every((label) => label.length === 2)).toBe(true);
    expect(many.slice(0, 3)).toEqual(["aa", "as", "ad"]);
  });
});

describe("assignHints", () => {
  it("labels top-to-bottom, left-to-right and reuses a label for the same target", () => {
    const targets = assignHints([
      { row: 5, col: 2, key: "/b", value: "b" },
      { row: 1, col: 9, key: "/a2", value: "a2" },
      { row: 1, col: 0, key: "/a", value: "a" },
      { row: 7, col: 0, key: "/a", value: "a" },
    ]);
    expect(targets.map((t) => [t.label, t.row, t.col, t.value])).toEqual([
      ["a", 1, 0, "a"],
      ["s", 1, 9, "a2"],
      ["d", 5, 2, "b"],
      ["a", 7, 0, "a"],
    ]);
  });
});

describe("hintKey", () => {
  const state = {
    targets: assignHints(
      Array.from({ length: 30 }, (_, i) => ({
        row: i,
        col: 0,
        key: `/${i}`,
        value: i,
      })),
    ),
    typed: "",
  };
  it("opens on a complete label and narrows on a prefix", () => {
    const first = hintKey(state, "s");
    expect(first.effect).toEqual({ kind: "none" });
    expect(first.state.typed).toBe("s");
    expect(hintKey(first.state, "d").effect).toEqual({
      kind: "open",
      value: state.targets.find((target) => target.label === "sd")?.value,
    });
    const single = {
      targets: assignHints([{ row: 0, col: 0, key: "x", value: "x" }]),
      typed: "",
    };
    expect(hintKey(single, "a").effect).toEqual({ kind: "open", value: "x" });
  });
  it("ignores keys matching no label, backspaces, and cancels on Esc or Ctrl-c", () => {
    expect(hintKey(state, "1").state.typed).toBe("");
    expect(hintKey({ ...state, typed: "s" }, "backspace").state.typed).toBe("");
    expect(hintKey(state, "Esc").effect).toEqual({ kind: "cancel" });
    expect(hintKey(state, "Ctrl-c").effect).toEqual({ kind: "cancel" });
  });
});

describe("screenSpots", () => {
  it("finds known path mentions in visible rows with screen positions", () => {
    const spots = screenSpots(
      ["  open src/a.ts:4 and x/y.ts", "", "/abs/z.md"],
      { x: 10, y: 3 },
      (text) =>
        findPathMentions(text)
          .filter((mention) => mention.path !== "x/y.ts")
          .map((mention) => ({ ...mention, value: mention.raw })),
    );
    expect(spots).toEqual([
      { row: 3, col: 17, key: "src/a.ts:4", value: "src/a.ts:4" },
      { row: 5, col: 10, key: "/abs/z.md", value: "/abs/z.md" },
    ]);
  });
});
