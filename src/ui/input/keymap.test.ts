import { parseKeypress } from "@opentui/core";
import { expect, test } from "vitest";
import { BINDINGS } from "./bindings.js";
import {
  dispatch,
  helpRows,
  type Mode,
  paletteActions,
  paletteReturnMode,
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
  expect(dispatch({ kind: "insert" }, "pane", key("c", true))).toEqual({
    mode: normal,
    action: { type: "normal" },
  });
});
test("Ctrl-C leaves inputs and copy mode, and only arms quit from normal", () => {
  const ctrlC = key("c", true);
  expect(dispatch(normal, "pane", ctrlC).action).toEqual({ type: "quit" });
  expect(dispatch({ kind: "search", query: "x" }, "pane", ctrlC)).toEqual({
    mode: normal,
    action: { type: "search.cancel" },
  });
  expect(dispatch({ kind: "copy" }, "pane", ctrlC)).toEqual({
    mode: normal,
    action: { type: "copy.exit" },
  });
  expect(dispatch({ kind: "palette" }, "pane", ctrlC).action).toEqual({
    type: "palette.close",
  });
  expect(
    dispatch({ kind: "prefix", returnTo: "insert" }, "pane", ctrlC),
  ).toEqual({ mode: normal, action: { type: "normal" } });
});
test("prefix [ enters copy mode, which forwards keys to the pane", () => {
  const prefix = dispatch(normal, "pane", key("b", true)).mode;
  expect(dispatch(prefix, "pane", key("["))).toEqual({
    mode: { kind: "copy" },
    action: { type: "copy.start" },
  });
  expect(dispatch({ kind: "copy" }, "pane", key("j"))).toEqual({
    mode: { kind: "copy" },
    action: { type: "copy.key", key: "j" },
  });
  expect(dispatch({ kind: "copy" }, "pane", key("u", true)).action).toEqual({
    type: "copy.key",
    key: "Ctrl-u",
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
      section: b.modes.includes("prefix")
        ? "Ctrl-B"
        : b.modes.every((mode) => mode === "copy")
          ? "copy mode"
          : (b.context ?? "any"),
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

test("q is inert in normal mode and gt/gT cycle workspace tabs", () => {
  expect(dispatch(normal, "sidebar", key("q")).action).toBeNull();
  const first = dispatch(normal, "pane", key("g"));
  expect(dispatch(first.mode, "pane", key("t")).action).toEqual({
    type: "tab.cycle",
    delta: 1,
  });
  expect(dispatch(first.mode, "pane", key("T")).action).toEqual({
    type: "tab.cycle",
    delta: -1,
  });
});
test("Ctrl-N opens a new tab from every mode, including text input modes", () => {
  for (const mode of [
    normal,
    { kind: "insert" },
    { kind: "search", query: "draft" },
    { kind: "prefix" },
    { kind: "palette" },
  ] as const) {
    const result = dispatch(mode, "pane", key("n", true));
    expect(result.action).toEqual({ type: "tab.create" });
    expect(result.mode).toEqual(normal);
  }
});
test("management shortcuts work in normal mode and remain editable in insert", () => {
  for (const [name, ctrl, type] of [
    ["W", false, "workspace.create"],
    ["R", false, "workspace.rename"],
    ["r", false, "tab.rename"],
  ] as const) {
    expect(dispatch(normal, "pane", key(name, ctrl)).action).toEqual({ type });
    expect(
      dispatch({ kind: "insert" }, "pane", key(name, ctrl)).action,
    ).toBeNull();
  }
});

test("ZQ requests tab closure only in normal mode", () => {
  const first = dispatch(normal, "pane", key("Z"));
  expect(first.mode).toEqual({ kind: "normal", pending: "Z" });
  expect(dispatch(first.mode, "pane", key("Q")).action).toEqual({
    type: "tab.close",
  });
  expect(dispatch({ kind: "insert" }, "pane", key("Z")).action).toBeNull();
  expect(dispatch(first.mode, "pane", key("j")).action).toEqual({
    type: "scroll.lines",
    delta: 1,
  });
});
test("documented prompt keys stay typeable in insert mode", () => {
  expect(dispatch({ kind: "insert" }, "pane", key("g", true))).toEqual({
    mode: { kind: "insert" },
    action: null,
  });
  expect(dispatch({ kind: "insert" }, "pane", key("/")).action).toBeNull();
  expect(helpRows("Ctrl-B")).toContainEqual({
    section: "pane",
    keys: "Ctrl-G",
    description: "Edit prompt in $VISUAL/$EDITOR",
  });
});

function strokes(keys: string): Stroke[] {
  const named: Record<string, string> = {
    Enter: "return",
    Esc: "escape",
    Tab: "tab",
    Left: "left",
    Right: "right",
    Up: "up",
    Down: "down",
  };
  return (keys.split(" / ")[0] ?? "").split(" ").map((token) => {
    if (token === "Shift-Tab")
      return {
        name: "tab",
        ctrl: false,
        meta: false,
        shift: true,
        sequence: "",
      };
    if (token.startsWith("Ctrl-"))
      return key(token.slice(5).toLowerCase(), true);
    if (named[token]) return key(named[token]);
    if (/^[A-Z]$/.test(token))
      return {
        name: token.toLowerCase(),
        ctrl: false,
        meta: false,
        shift: true,
        sequence: token,
      };
    return key(token);
  });
}
test("every palette action is what its shortcut dispatches", () => {
  const actions = paletteActions("Ctrl-B");
  expect(actions.length).toBeGreaterThan(15);
  for (const entry of actions) {
    const bindings = BINDINGS.filter(
      (b) =>
        !b.inert && JSON.stringify(b.action) === JSON.stringify(entry.action),
    );
    for (const binding of bindings) {
      let mode: Mode = binding.modes.includes("prefix")
        ? { kind: "prefix" }
        : { kind: "normal", pending: "" };
      let action = null;
      for (const stroke of strokes(binding.keys)) {
        const result = dispatch(mode, binding.context ?? "pane", stroke);
        mode = result.mode;
        action = result.action;
      }
      expect(action).toEqual(entry.action);
    }
  }
});
test("F starts file hints in a pane, which forwards keys and leaves on Ctrl-C", () => {
  const shifted = { ...key("f"), shift: true, sequence: "F" };
  expect(dispatch(normal, "pane", shifted)).toEqual({
    mode: { kind: "hint" },
    action: { type: "hint.start" },
  });
  expect(dispatch(normal, "sidebar", shifted).action).toBeNull();
  expect(dispatch({ kind: "hint" }, "pane", key("s"))).toEqual({
    mode: { kind: "hint" },
    action: { type: "hint.key", key: "s" },
  });
  expect(dispatch({ kind: "hint" }, "pane", key("escape")).action).toEqual({
    type: "hint.key",
    key: "Esc",
  });
  expect(dispatch({ kind: "hint" }, "pane", key("c", true))).toEqual({
    mode: normal,
    action: { type: "hint.cancel" },
  });
  expect(
    BINDINGS.filter((b) => b.modes.includes("hint")).map((b) => b.keys),
  ).toEqual(["a s d f …", "Esc / Ctrl-C"]);
  expect(
    BINDINGS.some((b) => b.modes.includes("copy") && b.keys === "g f"),
  ).toBe(true);
  expect(
    paletteActions("Ctrl-B").some((a) => a.action.type === "hint.start"),
  ).toBe(false);
});

test("the palette returns to the mode it was opened from", () => {
  expect(paletteReturnMode({ kind: "insert" })).toEqual({ kind: "insert" });
  expect(paletteReturnMode({ kind: "prefix", returnTo: "insert" })).toEqual({
    kind: "insert",
  });
  expect(paletteReturnMode({ kind: "prefix" })).toEqual({
    kind: "normal",
    pending: "",
  });
  expect(paletteReturnMode({ kind: "copy" })).toEqual({
    kind: "normal",
    pending: "",
  });
  expect(paletteReturnMode({ kind: "search", query: "x" })).toEqual({
    kind: "search",
    query: "x",
  });
});
