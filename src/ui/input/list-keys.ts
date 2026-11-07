import { useRef, useState } from "react";
import type { Stroke } from "./keymap.js";

export interface ListKeyState {
  cursor: number;
  pendingG: boolean;
}
export type ListKeyResult = ListKeyState | "pass";

function clamp(cursor: number, length: number) {
  return Math.max(0, Math.min(length - 1, cursor));
}
/** Vim-style cursor movement for a list; "pass" means the key is not a list key. */
export function listKey(
  stroke: Stroke,
  state: ListKeyState,
  length: number,
  pageSize: number,
): ListKeyResult {
  const { cursor, pendingG } = state;
  const half = Math.max(1, Math.floor(pageSize / 2));
  const page = Math.max(1, pageSize);
  const to = (target: number): ListKeyState => ({
    cursor: clamp(target, length),
    pendingG: false,
  });
  if (stroke.meta || stroke.super) return "pass";
  if (stroke.ctrl) {
    switch (stroke.name) {
      case "n":
        return to(cursor + 1);
      case "p":
        return to(cursor - 1);
      case "d":
        return to(cursor + half);
      case "u":
        return to(cursor - half);
      case "f":
        return to(cursor + page);
      case "b":
        return to(cursor - page);
    }
    return "pass";
  }
  switch (stroke.name) {
    case "down":
      return to(cursor + 1);
    case "up":
      return to(cursor - 1);
    case "pagedown":
      return to(cursor + page);
    case "pageup":
      return to(cursor - page);
    case "home":
      return to(0);
    case "end":
      return to(length - 1);
  }
  switch (stroke.sequence) {
    case "j":
      return to(cursor + 1);
    case "k":
      return to(cursor - 1);
    case "G":
      return to(length - 1);
    case "g":
      return pendingG
        ? to(0)
        : { cursor: clamp(cursor, length), pendingG: true };
  }
  return "pass";
}

/** First visible row of a `size`-row window that keeps `cursor` roughly centred. */
export function listWindow(cursor: number, length: number, size: number) {
  return Math.max(0, Math.min(cursor - Math.floor(size / 2), length - size));
}

/** Cursor state plus a key handler for a popup list; `key` returns whether the stroke moved the cursor. */
export function useListCursor(length: number, pageSize: number) {
  const [, setCursor] = useState(0);
  const state = useRef<ListKeyState>({ cursor: 0, pendingG: false });
  const cursor = clamp(state.current.cursor, length);
  state.current.cursor = cursor;
  function key(stroke: Stroke): boolean {
    const result = listKey(stroke, state.current, length, pageSize);
    if (result === "pass") {
      state.current = { ...state.current, pendingG: false };
      return false;
    }
    state.current = result;
    setCursor(result.cursor);
    return true;
  }
  return { cursor, key, current: () => state.current.cursor };
}
