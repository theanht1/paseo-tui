import { describe, expect, it } from "vitest";
import {
  type CopyState,
  copyKey,
  documentLines,
  rebaseCopy,
  scrollCopy,
  selectionSpan,
  startCopy,
} from "./copy-mode.js";

function press(state: CopyState, ...keys: string[]) {
  let current = state;
  let effect: ReturnType<typeof copyKey>["effect"] = { kind: "none" };
  for (const key of keys) ({ state: current, effect } = copyKey(current, key));
  return { state: current, effect };
}
const doc = documentLines(["alpha beta-gamma", "", "second line here"], 80);

describe("copy mode", () => {
  it("starts on the last line and moves with vim keys", () => {
    const state = startCopy(doc, 10);
    expect(state.cursor).toEqual({ row: 2, col: 0 });
    expect(press(state, "k", "k", "l", "l").state.cursor).toEqual({
      row: 0,
      col: 2,
    });
    expect(press(state, "$").state.cursor).toEqual({ row: 2, col: 15 });
    expect(press(state, "$", "0").state.cursor).toEqual({ row: 2, col: 0 });
    expect(press(state, "g", "g").state.cursor).toEqual({ row: 0, col: 0 });
    expect(press(state, "g", "g", "G").state.cursor).toEqual({
      row: 2,
      col: 0,
    });
    expect(press(state, "j", "h").state.cursor).toEqual({ row: 2, col: 0 });
  });

  it("moves by words across lines", () => {
    const top = press(startCopy(doc, 10), "g", "g").state;
    expect(press(top, "w").state.cursor).toEqual({ row: 0, col: 6 });
    expect(press(top, "w", "w").state.cursor).toEqual({ row: 0, col: 10 });
    expect(press(top, "e").state.cursor).toEqual({ row: 0, col: 4 });
    expect(press(top, "$", "w").state.cursor).toEqual({ row: 1, col: 0 });
    expect(press(top, "$", "w", "w").state.cursor).toEqual({ row: 2, col: 0 });
    expect(press(top, "w", "b").state.cursor).toEqual({ row: 0, col: 0 });
  });

  it("pages half a screen with Ctrl-u / Ctrl-d", () => {
    const lines = documentLines(
      Array.from({ length: 30 }, (_, i) => `line ${i}`),
      80,
    );
    const state = startCopy(lines, 10);
    expect(press(state, "Ctrl-u").state.cursor.row).toBe(24);
    expect(press(state, "Ctrl-u", "Ctrl-d").state.cursor.row).toBe(29);
  });

  it("yanks a character selection and exits", () => {
    const top = press(startCopy(doc, 10), "g", "g").state;
    const { state, effect } = press(top, "w", "v", "e");
    expect(selectionSpan(state, 0)).toEqual({ start: 6, end: 10 });
    expect(press(state, "y").effect).toEqual({ kind: "yank", text: "beta" });
    expect(effect).toEqual({ kind: "none" });
  });

  it("yanks whole lines with V, spanning rows", () => {
    const top = press(startCopy(doc, 10), "g", "g").state;
    const { effect } = press(top, "l", "V", "j", "j", "y");
    expect(effect).toEqual({
      kind: "yank",
      text: "alpha beta-gamma\n\nsecond line here",
    });
  });

  it("joins soft-wrapped lines when yanking", () => {
    const wrapped = documentLines(["abcdefgh"], 4);
    expect(wrapped.map((line) => line.text)).toEqual(["abcd", "efgh"]);
    const { effect } = press(startCopy(wrapped, 5), "V", "k", "y");
    expect(effect).toEqual({ kind: "yank", text: "abcdefgh" });
  });

  it("exits on Esc and q, and Esc first clears a selection", () => {
    const state = startCopy(doc, 10);
    expect(press(state, "q").effect).toEqual({ kind: "exit" });
    expect(press(state, "Esc").effect).toEqual({ kind: "exit" });
    const selecting = press(state, "v").state;
    const cleared = press(selecting, "Esc");
    expect(cleared.effect).toEqual({ kind: "none" });
    expect(cleared.state.selection).toBeNull();
  });

  it("y without a selection yanks the cursor line", () => {
    expect(press(startCopy(doc, 10), "y").effect).toEqual({
      kind: "yank",
      text: "second line here",
    });
  });

  it("keeps the cursor inside the visible window", () => {
    const lines = documentLines(
      Array.from({ length: 30 }, (_, i) => `line ${i}`),
      80,
    );
    const state = startCopy(lines, 10);
    expect(state.top).toBe(20);
    expect(press(state, "g", "g").state.top).toBe(0);
  });
});

it("gf reports the logical line and column under the cursor, joining soft wraps", () => {
  const state = startCopy(
    documentLines(["intro", "edit src/long/path.ts:9 now"], 10),
    5,
  );
  let current = state;
  for (const key of ["g", "g", "j", "j", "l", "l"])
    current = copyKey(current, key).state;
  expect(current.cursor).toEqual({ row: 2, col: 2 });
  const result = copyKey(copyKey(current, "g").state, "f");
  expect(result.effect).toEqual({
    kind: "file",
    text: "edit src/long/path.ts:9 now",
    col: 12,
  });
  expect(result.state.pending).toBe("");
});

it("pages with d/u and Ctrl-d/u by half a screen, and Ctrl-f/b or PgDn/PgUp by a screen", () => {
  const lines = documentLines(
    Array.from({ length: 40 }, (_, index) => `line ${index}`),
    80,
  );
  let state = startCopy(lines, 10);
  expect(state.cursor.row).toBe(39);
  const press = (key: string) => {
    state = copyKey(state, key).state;
    return state.cursor.row;
  };
  expect(press("u")).toBe(34);
  expect(press("Ctrl-u")).toBe(29);
  expect(press("Ctrl-b")).toBe(19);
  expect(press("PgUp")).toBe(9);
  expect(state.top).toBe(9);
  expect(press("d")).toBe(14);
  expect(press("Ctrl-d")).toBe(19);
  expect(press("Ctrl-f")).toBe(29);
  expect(press("PgDn")).toBe(39);
  expect(press("k")).toBe(38);
  expect(press("j")).toBe(39);
});

it("keeps the cursor, viewport and selection on the same text when older lines are prepended", () => {
  const lines = documentLines(["a", "b", "c"], 80);
  let state = startCopy(lines, 2);
  state = copyKey(state, "k").state;
  state = copyKey(state, "v").state;
  state = copyKey(state, "k").state;
  const rebased = rebaseCopy(
    state,
    documentLines(["older 1", "older 2", "a", "b", "c", "d"], 80),
    2,
  );
  expect(rebased.cursor).toEqual({ row: 2, col: 0 });
  expect(rebased.top).toBe(state.top + 2);
  expect(rebased.selection?.anchor).toEqual({ row: 3, col: 0 });
  expect(rebased.lines[rebased.cursor.row]?.text).toBe("a");
});

describe("tmux vi copy-mode keys", () => {
  const text = documentLines(
    [
      "first para line one",
      "first para (two) end",
      "",
      "second  WORD-ish.thing here",
      "",
      "third foo bar foo",
    ],
    80,
  );
  const top = () => press(startCopy(text, 4), "g", "g").state;
  const at = (...keys: string[]) => press(top(), ...keys).state.cursor;

  it("jumps paragraphs with { and }", () => {
    expect(at("}")).toEqual({ row: 2, col: 0 });
    expect(at("}", "}")).toEqual({ row: 4, col: 0 });
    expect(at("}", "}", "}")).toEqual({ row: 5, col: 0 });
    expect(at("G", "{")).toEqual({ row: 4, col: 0 });
    expect(at("G", "{", "{", "{")).toEqual({ row: 0, col: 0 });
  });

  it("moves by WORDs with W B E and to the first non-blank with ^", () => {
    const second = press(top(), "j", "j", "j").state;
    const go = (...keys: string[]) => press(second, ...keys).state.cursor;
    expect(go("W")).toEqual({ row: 3, col: 8 });
    expect(go("W", "E")).toEqual({ row: 3, col: 21 });
    expect(go("W", "W", "B")).toEqual({ row: 3, col: 8 });
    expect(go("w", "w")).toEqual({ row: 3, col: 12 });
    expect(go("$", "^")).toEqual({ row: 3, col: 0 });
  });

  it("finds characters with f F t T and repeats with ; and ,", () => {
    expect(at("f", "a")).toEqual({ row: 0, col: 7 });
    expect(at("f", "a", ";")).toEqual({ row: 0, col: 9 });
    expect(at("f", "i", ";")).toEqual({ row: 0, col: 12 });
    expect(at("f", "i", ";", ",")).toEqual({ row: 0, col: 1 });
    expect(at("t", "p")).toEqual({ row: 0, col: 5 });
    expect(at("$", "F", "l")).toEqual({ row: 0, col: 11 });
    expect(at("$", "T", "l")).toEqual({ row: 0, col: 12 });
  });

  it("matches brackets with %", () => {
    expect(at("j", "%")).toEqual({ row: 1, col: 15 });
    expect(at("j", "%", "%")).toEqual({ row: 1, col: 11 });
  });

  it("repeats motions with a count, keeping 0 as line start", () => {
    expect(at("3", "j")).toEqual({ row: 3, col: 0 });
    expect(at("1", "0", "l")).toEqual({ row: 0, col: 10 });
    expect(at("l", "l", "0")).toEqual({ row: 0, col: 0 });
  });

  it("searches forward with / and backward with ?, repeating with n and N", () => {
    expect(at("/", "f", "o", "o", "Enter")).toEqual({ row: 5, col: 6 });
    expect(at("/", "f", "o", "o", "Enter", "n")).toEqual({ row: 5, col: 14 });
    expect(at("/", "f", "o", "o", "Enter", "n", "N")).toEqual({
      row: 5,
      col: 6,
    });
    expect(at("G", "?", "p", "a", "r", "a", "Enter")).toEqual({
      row: 1,
      col: 6,
    });
    expect(at("/", "x", "y", "backspace", "Esc")).toEqual({ row: 0, col: 0 });
    const typing = press(top(), "/", "t", "w").state;
    expect(typing.search).toEqual({ dir: 1, query: "tw" });
  });

  it("searches for the word under the cursor with * and #", () => {
    const third = press(top(), "G", "w").state;
    expect(press(third, "*").state.cursor).toEqual({ row: 5, col: 14 });
    expect(press(third, "*", "#").state.cursor).toEqual({ row: 5, col: 6 });
  });

  it("puts H M L on the top, middle and bottom of the screen", () => {
    expect(at("H")).toEqual({ row: 0, col: 0 });
    expect(at("M")).toEqual({ row: 1, col: 0 });
    expect(at("L")).toEqual({ row: 3, col: 0 });
  });

  it("scrolls the screen a line with Ctrl-e / Ctrl-y and J / K, dragging the cursor along", () => {
    const scrolled = press(top(), "Ctrl-e").state;
    expect(scrolled.top).toBe(1);
    expect(scrolled.cursor.row).toBe(1);
    expect(press(scrolled, "Ctrl-y").state.top).toBe(0);
    expect(press(top(), "J", "J").state.top).toBe(2);
    expect(press(top(), "J", "J", "K").state.top).toBe(1);
    expect(press(top(), "J", "J", "J", "J", "J").state.top).toBe(2);
  });

  it("starts a selection with Space, swaps ends with o, and yanks a rectangle after Ctrl-v", () => {
    const selected = press(top(), "Space", "e");
    expect(selectionSpan(selected.state, 0)).toEqual({ start: 0, end: 5 });
    expect(press(selected.state, "o").state.cursor).toEqual({
      row: 0,
      col: 0,
    });
    expect(press(selected.state, "o", "y").effect).toEqual({
      kind: "yank",
      text: "first",
    });
    const block = press(top(), "l", "Ctrl-v", "j", "l", "l", "y");
    expect(block.effect).toEqual({ kind: "yank", text: "irs\nirs" });
  });
});

it("scrolls the screen for the mouse wheel, keeping the cursor on screen", () => {
  const lines = documentLines(
    Array.from({ length: 30 }, (_, index) => `line ${index}`),
    80,
  );
  const state = startCopy(lines, 10);
  expect(state.top).toBe(20);
  const up = scrollCopy(state, -3);
  expect(up.top).toBe(17);
  expect(up.cursor.row).toBe(26);
  const far = scrollCopy(state, -50);
  expect(far.top).toBe(0);
  expect(far.cursor.row).toBe(9);
  expect(scrollCopy(far, 100).top).toBe(20);
});
