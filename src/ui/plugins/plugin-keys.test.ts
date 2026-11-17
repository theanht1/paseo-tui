import { expect, test } from "vitest";
import { BINDINGS } from "../input/bindings.js";
import { actionId } from "../input/key-overrides.js";
import { dispatch, helpRows, shortcutFor } from "../input/keymap.js";
import { pluginBindings, unloadedPluginKeys } from "./plugin-keys.js";

const refresh = {
  pluginId: "board",
  action: { id: "refresh", title: "Refresh board", defaultKeys: ["Ctrl-y"] },
};
const open = { pluginId: "board", action: { id: "open", title: "Open board" } };
const none = new Map<string, readonly string[]>();
const active = new Set(["board"]);
function pressed(
  bindings: ReturnType<typeof pluginBindings>["bindings"],
  name: string,
  ctrl = false,
) {
  return dispatch(
    { kind: "normal", pending: "" },
    "pane",
    { name, ctrl, meta: false, shift: false, sequence: name },
    undefined,
    bindings,
  ).action;
}

test("a plugin action's default keys run it in normal mode and show in help", () => {
  const { bindings, errors } = pluginBindings(
    BINDINGS,
    [refresh, open, refresh],
    none,
    active,
  );
  expect(errors).toEqual([]);
  const action = {
    type: "plugin",
    plugin: "board",
    action: "refresh",
  } as const;
  expect(actionId(action)).toBe("plugin.board.refresh");
  expect(pressed(bindings, "y", true)).toEqual(action);
  expect(shortcutFor(action, bindings, "Ctrl-B")).toBe("Ctrl-y");
  expect(
    shortcutFor(
      { type: "plugin", plugin: "board", action: "open" },
      bindings,
      "Ctrl-B",
    ),
  ).toBeNull();
  expect(helpRows("Ctrl-B", bindings)).toContainEqual({
    section: "any",
    keys: "Ctrl-y",
    description: "Refresh board",
  });
  expect(bindings.filter((b) => b.action.type === "plugin")).toHaveLength(1);
});

test("keys rebinds or unbinds a plugin action", () => {
  const rebound = pluginBindings(
    BINDINGS,
    [refresh, open],
    new Map([
      ["plugin.board.refresh", ["F7"]],
      ["plugin.board.open", ["F8"]],
    ]),
    active,
  );
  expect(rebound.errors).toEqual([]);
  expect(pressed(rebound.bindings, "y", true)).toBeNull();
  expect(pressed(rebound.bindings, "f7")).toEqual({
    type: "plugin",
    plugin: "board",
    action: "refresh",
  });
  expect(pressed(rebound.bindings, "f8")).toEqual({
    type: "plugin",
    plugin: "board",
    action: "open",
  });
  const unbound = pluginBindings(
    BINDINGS,
    [refresh],
    new Map([["plugin.board.refresh", []]]),
    active,
  );
  expect(unbound.errors).toEqual([]);
  expect(pressed(unbound.bindings, "y", true)).toBeNull();
});

test("reports bad plugin keys like other key errors and keeps the rest", () => {
  const { bindings, errors } = pluginBindings(
    BINDINGS,
    [
      refresh,
      {
        pluginId: "board",
        action: { id: "clash", title: "Clash", defaultKeys: ["j"] },
      },
    ],
    new Map([
      ["plugin.board.refresh", ["nonsense key"]],
      ["plugin.board.missing", ["F9"]],
      ["plugin.asleep.thing", ["F10"]],
    ]),
    active,
  );
  expect(errors).toEqual([
    'keys."plugin.board.refresh": "nonsense key" is a multi-key chord; only single keys can be bound',
    expect.stringMatching(
      /^keys\."plugin\.board\.clash": "j" conflicts with .+ in normal mode$/,
    ),
    'keys."plugin.board.missing": unknown action; valid: plugin.board.refresh, plugin.board.clash',
  ]);
  // The bad override falls back to the default key; the clashing default stays unbound.
  expect(pressed(bindings, "y", true)).toEqual({
    type: "plugin",
    plugin: "board",
    action: "refresh",
  });
  expect(bindings.filter((b) => b.action.type === "plugin")).toHaveLength(1);
});

test("keys for a plugin that is not loaded are reported", () => {
  expect(
    unloadedPluginKeys(
      new Map([
        ["plugin.board.refresh", ["y"]],
        ["plugin.bored.refresh", ["Y"]],
        ["plugin.board", ["F9"]],
      ]),
      ["board", "notes"],
    ),
  ).toEqual([
    'keys."plugin.bored.refresh": no loaded plugin has this id; loaded: board, notes',
    'keys."plugin.board": expected plugin.<pluginId>.<actionId>',
  ]);
});
