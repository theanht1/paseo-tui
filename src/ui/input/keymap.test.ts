import { parseKeypress } from "@opentui/core";
import { expect, test } from "vitest";
import {
  BINDINGS,
  dispatch,
  helpRows,
  parsePrefix,
  type Stroke,
} from "./keymap.js";

function key(name: string, ctrl = false): Stroke {
  return { name, ctrl, meta: false, shift: false, sequence: name };
}
const normal = { kind: "normal", pending: "" } as const;
test("gg chord depends on context and resets on unbound keys", () => {
  const first = dispatch(normal, "sidebar", key("g"));
  expect(first.mode).toEqual({ kind: "normal", pending: "g" });
  expect(dispatch(first.mode, "sidebar", key("g")).action).toEqual({
    type: "list.edge",
    edge: "top",
  });
  expect(dispatch(first.mode, "pane", key("g")).action).toEqual({
    type: "scroll.edge",
    edge: "top",
  });
  expect(dispatch(first.mode, "pane", key("z")).mode).toEqual(normal);
});
test("insert passes all keys except escape and ctrl-c", () => {
  for (const k of [key("q"), key("?"), key("x", true), key("tab")])
    expect(dispatch({ kind: "insert" }, "pane", k).action).toBeNull();
  expect(dispatch({ kind: "insert" }, "pane", key("escape")).action).toEqual({
    type: "normal",
  });
  expect(dispatch({ kind: "insert" }, "pane", key("c", true)).action).toEqual({
    type: "quit",
  });
});
test("sidebar and pane use the same table with different actions", () => {
  expect(dispatch(normal, "sidebar", key("j")).action).toEqual({
    type: "list.move",
    delta: 1,
  });
  expect(dispatch(normal, "pane", key("j")).action).toEqual({
    type: "scroll.lines",
    delta: 1,
  });
  for (const b of BINDINGS)
    expect(helpRows("Ctrl-B")).toContainEqual({
      section: b.modes.includes("prefix") ? "Ctrl-B" : (b.context ?? "any"),
      keys: b.keys,
      description: b.description,
    });
});

test("prefix split, consumption, insert, custom prefix, and vim focus", () => {
  const prefix = dispatch(normal, "pane", key("b", true)).mode;
  expect(prefix.kind).toBe("prefix");
  expect(dispatch(prefix, "pane", key("%")).action).toEqual({
    type: "pane.split",
    direction: "right",
  });
  expect(dispatch(prefix, "pane", key("!")).mode).toEqual(normal);
  expect(dispatch({ kind: "insert" }, "pane", key("b", true)).mode.kind).toBe(
    "prefix",
  );
  expect(
    dispatch(normal, "pane", key("b", true), parsePrefix("C-a")).action,
  ).toEqual({ type: "scroll.page", dir: -1 });
  expect(() => parsePrefix("M-x")).toThrow(/C-<letter>/);
  const vim = dispatch(normal, "pane", key("w", true));
  expect(dispatch(vim.mode, "pane", key("l")).action).toEqual({
    type: "pane.focus",
    direction: "right",
  });
});
test("an unbound key after a prefix from insert mode returns to insert", () => {
  const prefix = dispatch({ kind: "insert" }, "pane", key("b", true)).mode;
  expect(dispatch(prefix, "pane", key("!"))).toEqual({
    mode: { kind: "insert" },
    action: null,
  });
});

test("OpenTUI Shift-Tab cycles modes only in a normal pane", () => {
  const stroke = parseKeypress("\u001b[Z");
  if (!stroke) throw Error("missing parsed key");
  expect(stroke.name).toBe("tab");
  expect(stroke.shift).toBe(true);
  expect(dispatch(normal, "pane", stroke).action).toEqual({
    type: "agent.cycleMode",
  });
  expect(dispatch(normal, "sidebar", stroke).action).toBeNull();
  expect(dispatch({ kind: "insert" }, "pane", stroke).action).toBeNull();
});
