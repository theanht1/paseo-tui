import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import type { Stroke } from "./keymap.js";
import { listKey, listWindow, useListCursor } from "./list-keys.js";

function stroke(name: string, extra: Partial<Stroke> = {}): Stroke {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name,
    ...extra,
  };
}
const ctrl = (name: string) => stroke(name, { ctrl: true });
function press(s: Stroke, cursor: number, pendingG = false, length = 30) {
  return listKey(s, { cursor, pendingG }, length, 10);
}

it("moves one row with j/k, arrows and Ctrl-n/Ctrl-p, clamped to the list", () => {
  expect(press(stroke("j"), 3)).toEqual({ cursor: 4, pendingG: false });
  expect(press(stroke("down"), 3)).toEqual({ cursor: 4, pendingG: false });
  expect(press(ctrl("n"), 3)).toEqual({ cursor: 4, pendingG: false });
  expect(press(stroke("k"), 3)).toEqual({ cursor: 2, pendingG: false });
  expect(press(stroke("up"), 0)).toEqual({ cursor: 0, pendingG: false });
  expect(press(ctrl("p"), 3)).toEqual({ cursor: 2, pendingG: false });
  expect(press(stroke("j"), 29)).toEqual({ cursor: 29, pendingG: false });
});

it("jumps half and full pages and to the ends", () => {
  expect(press(ctrl("d"), 3)).toEqual({ cursor: 8, pendingG: false });
  expect(press(ctrl("u"), 3)).toEqual({ cursor: 0, pendingG: false });
  expect(press(ctrl("f"), 3)).toEqual({ cursor: 13, pendingG: false });
  expect(press(stroke("pagedown"), 25)).toEqual({
    cursor: 29,
    pendingG: false,
  });
  expect(press(ctrl("b"), 15)).toEqual({ cursor: 5, pendingG: false });
  expect(press(stroke("pageup"), 15)).toEqual({ cursor: 5, pendingG: false });
  expect(press(stroke("home"), 15)).toEqual({ cursor: 0, pendingG: false });
  expect(press(stroke("end"), 15)).toEqual({ cursor: 29, pendingG: false });
  expect(press(stroke("G", { sequence: "G", shift: true }), 15)).toEqual({
    cursor: 29,
    pendingG: false,
  });
});

it("moves to the top on g g and cancels a pending g on any other key", () => {
  const first = press(stroke("g"), 15);
  expect(first).toEqual({ cursor: 15, pendingG: true });
  expect(press(stroke("g"), 15, true)).toEqual({ cursor: 0, pendingG: false });
  expect(press(stroke("j"), 15, true)).toEqual({ cursor: 16, pendingG: false });
  expect(press(stroke("x"), 15, true)).toBe("pass");
});

it("passes keys it does not own and ignores modified letters", () => {
  expect(press(stroke("x"), 3)).toBe("pass");
  expect(press(stroke("return"), 3)).toBe("pass");
  expect(press(stroke("j", { meta: true }), 3)).toBe("pass");
  expect(press(ctrl("j"), 3)).toBe("pass");
});

it("stays put on an empty list", () => {
  expect(press(stroke("j"), 0, false, 0)).toEqual({
    cursor: 0,
    pendingG: false,
  });
  expect(press(stroke("G"), 0, false, 0)).toEqual({
    cursor: 0,
    pendingG: false,
  });
});

it("moves at least one row for tiny page sizes", () => {
  expect(listKey(ctrl("d"), { cursor: 0, pendingG: false }, 5, 1)).toEqual({
    cursor: 1,
    pendingG: false,
  });
});

it("windows the list around the cursor", () => {
  expect(listWindow(0, 30, 10)).toBe(0);
  expect(listWindow(5, 30, 10)).toBe(0);
  expect(listWindow(15, 30, 10)).toBe(10);
  expect(listWindow(29, 30, 10)).toBe(20);
  expect(listWindow(2, 4, 10)).toBe(0);
});

const probe: { api: ReturnType<typeof useListCursor> | null } = { api: null };
function Probe({ length }: { length: number }) {
  probe.api = useListCursor(length, 4);
  return <text>{String(probe.api.cursor)}</text>;
}
function hook() {
  if (!probe.api) throw Error("Probe not rendered");
  return probe.api;
}
it("re-clamps the hook cursor when the list shrinks", async () => {
  const test = await createTestRenderer({ width: 10, height: 4 });
  const root = createRoot(test.renderer);
  try {
    flushSync(() => root.render(<Probe length={10} />));
    flushSync(() => hook().key(stroke("G")));
    expect(hook().cursor).toBe(9);
    flushSync(() => root.render(<Probe length={3} />));
    expect(hook().cursor).toBe(2);
    expect(hook().current()).toBe(2);
    flushSync(() => hook().key(stroke("j")));
    expect(hook().cursor).toBe(2);
  } finally {
    await test.dispose();
  }
});
