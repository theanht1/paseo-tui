import { expect, test } from "vitest";
import { BINDINGS } from "./bindings.js";
import {
  actionId,
  applyKeyOverrides,
  rebindableActions,
} from "./key-overrides.js";
import {
  dispatch,
  helpRows,
  type Mode,
  paletteActions,
  type Stroke,
} from "./keymap.js";

function key(name: string, ctrl = false): Stroke {
  return { name, ctrl, meta: false, shift: false, sequence: name };
}
const normal: Mode = { kind: "normal", pending: "" };

function rebind(keys: Record<string, readonly string[]>) {
  return applyKeyOverrides(BINDINGS, new Map(Object.entries(keys)));
}

test("action ids join the action type and its arguments", () => {
  expect(actionId({ type: "tab.cycle", delta: 1 })).toBe("tab.cycle:1");
  expect(actionId({ type: "pane.split", direction: "right" })).toBe(
    "pane.split:right",
  );
  expect(actionId({ type: "help" })).toBe("help");
  expect(rebindableActions(BINDINGS)).toContain("pane.select:3");
  expect(rebindableActions(BINDINGS)).not.toContain("tab.close");
  expect(rebindableActions(BINDINGS)).not.toContain("copy.key:y / Enter");
});

test("rebinding replaces the default keys in dispatch, help and the Command Center", () => {
  const result = rebind({
    "workspace.create": ["Ctrl-o", "w"],
    "pane.split:right": ["|"],
  });
  expect(result.errors).toEqual([]);
  const { bindings } = result;
  expect(dispatch(normal, "pane", key("W"), undefined, bindings).action).toBe(
    null,
  );
  for (const stroke of [key("o", true), key("w")])
    expect(
      dispatch(normal, "pane", stroke, undefined, bindings).action,
    ).toEqual({ type: "workspace.create" });
  expect(
    dispatch({ kind: "prefix" }, "pane", key("|"), undefined, bindings).action,
  ).toEqual({ type: "pane.split", direction: "right" });
  expect(
    dispatch({ kind: "prefix" }, "pane", key("%"), undefined, bindings).action,
  ).toBeNull();
  expect(
    paletteActions("Ctrl-B", bindings).find(
      (entry) => entry.action.type === "workspace.create",
    )?.shortcut,
  ).toBe("Ctrl-o / w");
  expect(
    helpRows("Ctrl-B", bindings).find(
      (row) => row.description === "Split right",
    )?.keys,
  ).toBe("|");
});

test("rebinding an always-on key moves it out of text input too", () => {
  const { bindings, errors } = rebind({
    "tab.create": ["Ctrl-t"],
    "palette.open": ["Ctrl-p"],
  });
  expect(errors).toEqual([]);
  for (const mode of [normal, { kind: "insert" }] as const) {
    expect(
      dispatch(mode, "pane", key("t", true), undefined, bindings).action,
    ).toEqual({ type: "tab.create" });
    expect(
      dispatch(mode, "pane", key("n", true), undefined, bindings).action,
    ).toBeNull();
    expect(dispatch(mode, "pane", key("p", true), undefined, bindings)).toEqual(
      { mode: { kind: "palette" }, action: { type: "palette.open" } },
    );
  }
  expect(
    dispatch(normal, "pane", key(":"), undefined, bindings).action,
  ).toBeNull();
  expect(
    helpRows("Ctrl-B", bindings)
      .filter((row) => row.description === "Command Center")
      .map((row) => row.keys),
  ).toEqual(["Ctrl-p"]);
});

test("an empty key list unbinds the action", () => {
  const { bindings, errors } = rebind({ "sidebar.toggle": [] });
  expect(errors).toEqual([]);
  expect(dispatch(normal, "pane", key("\\"), undefined, bindings).action).toBe(
    null,
  );
  expect(
    helpRows("Ctrl-B", bindings).some(
      (row) => row.description === "Toggle sidebar",
    ),
  ).toBe(false);
});

test("Ctrl-w pane focus follows the rebound focus keys", () => {
  const { bindings } = rebind({ "pane.focus:left": ["y"] });
  const pending = dispatch(normal, "pane", key("w", true), undefined, bindings);
  expect(
    dispatch(pending.mode, "pane", key("y"), undefined, bindings).action,
  ).toEqual({ type: "pane.focus", direction: "left" });
});

test("reports unknown actions, fixed chords, bad keys, reserved keys and conflicts", () => {
  const { errors } = rebind({
    "tab.explode": ["x"],
    "tab.close": ["X"],
    "pane.zoom": ["g z"],
    "pane.next": ["Hyper-q"],
    "tab.rename": ["Ctrl-c"],
    "workspace.rename": ["g"],
    "sidebar.toggle": ["n"],
    "tab.create": ["t"],
  });
  expect(errors).toEqual([
    expect.stringMatching(
      /^keys\."tab\.explode": unknown action; valid: .*help/,
    ),
    'keys."tab.close": not rebindable (fixed chord)',
    'keys."pane.zoom": "g z" is a multi-key chord; only single keys can be bound',
    'keys."pane.next": "Hyper-q" is not a key (use e.g. x, X, Ctrl-x, Meta-x, Cmd-x, Enter, Esc, Tab, Shift-Tab, Up, PgDn, F1)',
    'keys."tab.rename": "Ctrl-c" is reserved',
    'keys."workspace.rename": "g" is reserved in normal mode',
    'keys."tab.create": "t" would be typed as text; use a Ctrl-, Meta- or Cmd- key',
    'keys."sidebar.toggle": "n" conflicts with search.next:1 in normal mode',
  ]);
});

test("the default table has no conflicts and named keys are normalized", () => {
  expect(rebind({}).errors).toEqual([]);
  const { bindings, errors } = rebind({
    "sidebar.toggle": ["alt-s", "f2", "end"],
  });
  expect(errors).toEqual([]);
  expect(bindings.find((b) => b.action.type === "sidebar.toggle")?.keys).toBe(
    "Meta-s / f2 / end",
  );
  expect(
    dispatch(normal, "pane", { ...key("s"), meta: true }, undefined, bindings)
      .action,
  ).toEqual({ type: "sidebar.toggle" });
});
test("Cmd and Super keys rebind to Super- and work while typing", () => {
  const { bindings, errors } = rebind({
    "tab.create": ["cmd-t"],
    "sidebar.toggle": ["Super-b"],
  });
  expect(errors).toEqual([]);
  expect(bindings.find((b) => b.action.type === "tab.create")?.keys).toBe(
    "Super-t",
  );
  expect(
    dispatch(normal, "pane", { ...key("b"), super: true }, undefined, bindings)
      .action,
  ).toEqual({ type: "sidebar.toggle" });
});
