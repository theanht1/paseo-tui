import { parseKeypress } from "@opentui/core";
import { expect, test } from "vitest";
import {
  BINDINGS,
  positionModifiers,
  workspaceJumpBindings,
} from "./bindings.js";
import { applyKeyOverrides } from "./key-overrides.js";
import {
  actionMode,
  dispatch,
  helpRows,
  type Mode,
  paletteActions,
  paletteReturnMode,
  parsePrefix,
  type Stroke,
  shortcutFor,
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
test("insert passes typing keys through, keeping Esc, Ctrl-C and Ctrl-X (stop)", () => {
  for (const k of [key("q"), key("?"), key("e", true), key("tab")])
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
test("gd opens the diff tool from either context and is in the Command Center", () => {
  for (const context of ["sidebar", "pane"] as const) {
    const first = dispatch(normal, context, key("g"));
    const result = dispatch(first.mode, context, key("d"));
    expect(result.action).toEqual({ type: "diff.open" });
    expect(result.mode).toEqual(normal);
  }
  expect(paletteActions("Ctrl-B")).toContainEqual({
    action: { type: "diff.open" },
    title: "Open changes (lazygit)",
    shortcut: "g d",
    keywords: ["diff", "open"],
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
    PgUp: "pageup",
    PgDn: "pagedown",
  };
  return keys.split(" ").map((token) => {
    if (token.startsWith("Super-"))
      return { ...key(token.slice(6)), super: true };
    if (token.startsWith("Meta-"))
      return { ...key(token.slice(5)), meta: true };
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
    const expected =
      entry.action.type === "exit" ? { type: "quit" } : entry.action;
    const bound = BINDINGS.filter(
      (b) => !b.inert && JSON.stringify(b.action) === JSON.stringify(expected),
    );
    for (const binding of bound) {
      // Any one of a binding's alternatives (one may be shadowed by the prefix key).
      const reached = binding.keys.split(" / ").some((alternative) => {
        let mode: Mode = binding.modes.includes("prefix")
          ? { kind: "prefix" }
          : { kind: "normal", pending: "" };
        let action = null;
        for (const stroke of strokes(alternative)) {
          const result = dispatch(mode, binding.context ?? "pane", stroke);
          mode = result.mode;
          action = result.action;
        }
        return JSON.stringify(action) === JSON.stringify(expected);
      });
      expect(reached, `${binding.keys} → ${binding.description}`).toBe(true);
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
  ).toBe(true);
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
test("triage keys: U jumps to attention, S regroups, [ ] cycle workspaces, digits pick tabs", () => {
  for (const context of ["sidebar", "pane"] as const) {
    expect(dispatch(normal, context, key("U")).action).toEqual({
      type: "attention.next",
    });
    expect(dispatch(normal, context, key("S")).action).toEqual({
      type: "sidebar.toggleGrouping",
    });
    expect(dispatch(normal, context, key("]")).action).toEqual({
      type: "workspace.cycle",
      delta: 1,
    });
    expect(dispatch(normal, context, key("[")).action).toEqual({
      type: "workspace.cycle",
      delta: -1,
    });
    expect(dispatch(normal, context, key("3")).action).toEqual({
      type: "tab.select",
      index: 2,
    });
  }
  expect(dispatch({ kind: "insert" }, "pane", key("3")).action).toBeNull();
});
test("Alt-digit from a legacy terminal opens a workspace by position in normal and insert mode", () => {
  const alt = parseKeypress("\x1b2");
  if (!alt) throw Error("unparsed");
  const bindings = workspaceJumpBindings(["Meta"]);
  expect(dispatch(normal, "pane", alt, undefined, bindings).action).toEqual({
    type: "workspace.select",
    index: 1,
  });
  const inserting = dispatch(
    { kind: "insert" },
    "pane",
    alt,
    undefined,
    bindings,
  );
  expect(inserting).toEqual({
    mode: { kind: "insert" },
    action: { type: "workspace.select", index: 1 },
  });
});
test("the Command Center lists every shortcut action that does something from it", () => {
  const entries = paletteActions("C-b");
  const types = new Set(entries.map((entry) => entry.action.type));
  for (const type of [
    "attention.next",
    "sidebar.toggleGrouping",
    "workspace.cycle",
    "diff.open",
    "workspace.editor",
    "tab.select",
    "workspace.select",
    "pane.select",
    "search.start",
    "search.next",
    "scroll.half",
    "scroll.edge",
    "block.move",
    "block.toggle",
    "list.edge",
    "insert",
    "hint.start",
    "exit",
  ] as const)
    expect(types).toContain(type);
  for (const type of [
    "palette.open",
    "quit",
    "copy.key",
    "hint.key",
    "search.update",
    "list.move",
    "scroll.lines",
    "history.open",
    "agent.unarchive",
  ] as const)
    expect(types).not.toContain(type);
  expect(entries).toContainEqual({
    action: { type: "exit" },
    title: "Quit",
    shortcut: "Ctrl-C Ctrl-C",
    keywords: ["quit", "exit", "close"],
  });
  expect(
    entries.find((entry) => entry.title === "Open workspace 2")?.shortcut,
  ).toMatch(/^(Super-2 \/ )?Meta-2$/);
});
test("actions that enter a mode from the Command Center return to it", () => {
  expect(actionMode({ type: "search.start" })).toEqual({
    kind: "search",
    query: "",
  });
  expect(actionMode({ type: "hint.start" })).toEqual({ kind: "hint" });
  expect(actionMode({ type: "copy.start" })).toEqual({ kind: "copy" });
  expect(actionMode({ type: "insert" })).toEqual({ kind: "insert" });
  expect(actionMode({ type: "diff.open" })).toBeNull();
  expect(actionMode({ type: "workspace.editor" })).toBeNull();
});
test("jumps to a workspace by position with Cmd-digit (or Alt-digit) on macOS and Alt-digit elsewhere", () => {
  expect(positionModifiers("darwin")).toEqual(["Super", "Meta"]);
  expect(positionModifiers("win32")).toEqual(["Meta"]);
  expect(positionModifiers("linux")).toEqual(["Meta"]);
  const mac = workspaceJumpBindings(["Super", "Meta"]);
  const other = workspaceJumpBindings(["Meta"]);
  expect(mac[1]?.keys).toBe("Super-2 / Meta-2");
  const cmd2: Stroke = { ...key("2"), super: true, sequence: "2" };
  const alt2: Stroke = { ...key("2"), meta: true, sequence: "2" };
  const jump = { type: "workspace.select", index: 1 };
  for (const mode of [normal, { kind: "insert" } as const]) {
    expect(dispatch(mode, "pane", cmd2, undefined, mac).action).toEqual(jump);
    expect(dispatch(mode, "pane", alt2, undefined, mac).action).toEqual(jump);
    expect(dispatch(mode, "pane", alt2, undefined, other).action).toEqual(jump);
    expect(dispatch(mode, "pane", cmd2, undefined, other).action).toBeNull();
  }
});
test("H opens session history anywhere in normal mode; u unarchives only in a pane", () => {
  const shiftH = { ...key("h"), shift: true };
  expect(dispatch(normal, "sidebar", shiftH).action).toEqual({
    type: "history.open",
  });
  expect(dispatch(normal, "pane", shiftH).action).toEqual({
    type: "history.open",
  });
  expect(dispatch(normal, "pane", key("u")).action).toEqual({
    type: "agent.unarchive",
  });
  expect(dispatch(normal, "sidebar", key("u")).action).toBeNull();
  expect(dispatch({ kind: "copy" }, "pane", key("u")).action).toEqual({
    type: "copy.key",
    key: "u",
  });
});

test("shortcutFor labels an action from the effective bindings", () => {
  expect(shortcutFor({ type: "diff.open" }, BINDINGS, "Ctrl-B")).toBe("g d");
  expect(shortcutFor({ type: "pane.zoom" }, BINDINGS, "Ctrl-A")).toBe(
    "Ctrl-A z",
  );
  expect(shortcutFor({ type: "help" }, BINDINGS, "Ctrl-B")).toBe(
    "Ctrl-B ? / ?",
  );
  expect(shortcutFor({ type: "exit" }, BINDINGS, "Ctrl-B")).toBe(
    "Ctrl-C Ctrl-C",
  );
  expect(
    shortcutFor({ type: "search.update", query: "" }, BINDINGS, "Ctrl-B"),
  ).toBeNull();
  const { bindings, errors } = applyKeyOverrides(
    BINDINGS,
    new Map([["diff.open", ["Ctrl-Y"]]]),
  );
  expect(errors).toEqual([]);
  expect(shortcutFor({ type: "diff.open" }, bindings, "Ctrl-B")).toBe("Ctrl-Y");
  for (const entry of paletteActions("Ctrl-B", bindings))
    expect(entry.shortcut).toBe(
      shortcutFor(entry.action, bindings, "Ctrl-B") ?? "",
    );
});

test("Ctrl-X stops the turn while typing too, staying in insert mode", () => {
  expect(dispatch({ kind: "insert" }, "pane", key("x", true))).toEqual({
    mode: { kind: "insert" },
    action: { type: "stop" },
  });
  expect(dispatch(normal, "pane", key("x", true)).action).toEqual({
    type: "stop",
  });
});
test("t opens the prompt list from a focused pane, not the sidebar", () => {
  expect(dispatch(normal, "pane", key("t"))).toEqual({
    mode: normal,
    action: { type: "prompts.open" },
  });
  expect(dispatch(normal, "sidebar", key("t")).action).toBeNull();
  const g = dispatch(normal, "pane", key("g")).mode;
  expect(dispatch(g, "pane", key("t")).action).toEqual({
    type: "tab.cycle",
    delta: 1,
  });
});
test("queue keys work while typing and are not typed into the prompt", () => {
  const insert = { kind: "insert" } as const;
  const ctrl = (name: string) => key(name, true);
  expect(dispatch(insert, "pane", ctrl("s")).action).toEqual({
    type: "queue.send",
  });
  expect(dispatch(insert, "pane", ctrl("r")).action).toEqual({
    type: "queue.edit",
  });
  expect(dispatch(insert, "pane", ctrl("o")).action).toEqual({
    type: "queue.remove",
  });
  expect(dispatch(insert, "pane", ctrl("up")).action).toEqual({
    type: "queue.select",
    delta: -1,
  });
  expect(dispatch(insert, "pane", ctrl("down"))).toEqual({
    mode: insert,
    action: { type: "queue.select", delta: 1 },
  });
  expect(dispatch(normal, "pane", ctrl("s")).action).toBeNull();
  // The textarea's own editing keys stay with it (line end, delete, …).
  for (const name of ["e", "d", "a", "w", "u"])
    expect(dispatch(insert, "pane", ctrl(name)).action).toBeNull();
});
test("C clears the session from a focused pane only", () => {
  expect(dispatch(normal, "pane", key("C")).action).toEqual({
    type: "agent.clear",
  });
  expect(dispatch(normal, "sidebar", key("C")).action).toBeNull();
});
test("Ctrl-d/Ctrl-u move the sidebar cursor half a page and still scroll panes", () => {
  expect(dispatch(normal, "sidebar", key("d", true)).action).toEqual({
    type: "list.half",
    dir: 1,
  });
  expect(dispatch(normal, "sidebar", key("u", true)).action).toEqual({
    type: "list.half",
    dir: -1,
  });
  expect(dispatch(normal, "pane", key("d", true)).action).toEqual({
    type: "scroll.half",
    dir: 1,
  });
});
