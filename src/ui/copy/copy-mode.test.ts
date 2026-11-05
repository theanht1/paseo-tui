import { describe, expect, it } from "vitest";
import {
  type CopyState,
  copyKey,
  documentLines,
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
