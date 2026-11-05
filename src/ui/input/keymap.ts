import { BINDINGS } from "./bindings.js";
export interface Stroke {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
}
export type Mode =
  | { kind: "normal"; pending: string }
  | { kind: "insert" }
  | { kind: "prefix"; returnTo?: "normal" | "insert" }
  | { kind: "search"; query: string }
  | { kind: "palette" }
  | { kind: "copy" }
  | { kind: "hint" };
export type Context = "sidebar" | "pane";
export type Action =
  | {
      type:
        | "quit"
        | "help"
        | "insert"
        | "normal"
        | "focus.toggleSidebar"
        | "sidebar.toggle"
        | "list.open"
        | "block.toggle"
        | "block.toggleAll"
        | "block.expandAll"
        | "block.collapseAll"
        | "agent.cycleMode"
        | "stop"
        | "palette.open"
        | "palette.close"
        | "copy.start"
        | "copy.exit"
        | "hint.start"
        | "hint.cancel"
        | "prompt.edit"
        | "subagents.open"
        | "workspace.create"
        | "workspace.rename"
        | "tab.create"
        | "tab.createTerminal"
        | "tab.rename"
        | "tab.close";
    }
  | { type: "list.move" | "scroll.lines" | "block.move"; delta: number }
  | { type: "list.edge" | "scroll.edge"; edge: "top" | "bottom" }
  | { type: "scroll.half" | "scroll.page"; dir: 1 | -1 }
  | { type: "pane.split"; direction: "right" | "down" }
  | { type: "pane.focus"; direction: "left" | "right" | "up" | "down" }
  | {
      type:
        | "pane.next"
        | "pane.close"
        | "pane.zoom"
        | "pane.numbers"
        | "search.start"
        | "search.commit"
        | "search.cancel"
        | "prefix.literal";
    }
  | { type: "tab.cycle"; delta: number }
  | { type: "pane.select"; index: number }
  | { type: "search.update"; query: string }
  | { type: "search.next"; dir: 1 | -1 }
  | { type: "copy.key" | "hint.key"; key: string };
export interface Binding {
  keys: string;
  modes: Mode["kind"][];
  context?: Context;
  action: Action;
  description: string;
  /** Documented here for help and hints but handled by the focused input itself. */
  inert?: true;
}
function label(stroke: Stroke): string {
  if (stroke.ctrl) return `Ctrl-${stroke.name.toLowerCase()}`;
  if (stroke.name === "tab" && stroke.shift) return "Shift-Tab";
  if (stroke.meta) return `Meta-${stroke.name}`;
  const names: Record<string, string> = {
    return: "Enter",
    enter: "Enter",
    escape: "Esc",
    tab: "Tab",
    down: "Down",
    up: "Up",
    left: "Left",
    right: "Right",
    pagedown: "PgDn",
    pageup: "PgUp",
  };
  return (
    names[stroke.name] ??
    (stroke.shift && stroke.name.length === 1
      ? stroke.name.toUpperCase()
      : stroke.name)
  );
}
export function dispatch(
  mode: Mode,
  context: Context,
  stroke: Stroke,
  prefix: Stroke = parsePrefix("C-b"),
): { mode: Mode; action: Action | null } {
  const key = label(stroke);
  const normal: Mode = { kind: "normal", pending: "" };
  if (key.toLowerCase() === "ctrl-c") return interrupt(mode);
  if (key.toLowerCase() === "ctrl-n")
    return { mode: normal, action: { type: "tab.create" } };
  if (
    key.toLowerCase() === "ctrl-k" ||
    ((mode.kind === "normal" || mode.kind === "prefix") && key === ":")
  )
    return { mode: { kind: "palette" }, action: { type: "palette.open" } };
  if (mode.kind === "palette") return { mode, action: null };
  if (mode.kind === "copy") return { mode, action: { type: "copy.key", key } };
  if (mode.kind === "hint") return { mode, action: { type: "hint.key", key } };
  if (mode.kind === "search") {
    if (key === "Enter")
      return { mode: normal, action: { type: "search.commit" } };
    if (key === "Esc")
      return { mode: normal, action: { type: "search.cancel" } };
    const query =
      stroke.name === "backspace"
        ? mode.query.slice(0, -1)
        : !stroke.ctrl && !stroke.meta && stroke.sequence.length === 1
          ? mode.query + stroke.sequence
          : mode.query;
    return {
      mode: { kind: "search", query },
      action: { type: "search.update", query },
    };
  }
  if (key.toLowerCase() === label(prefix).toLowerCase()) {
    if (mode.kind === "prefix")
      return {
        mode: mode.returnTo === "insert" ? { kind: "insert" } : normal,
        action: mode.returnTo === "insert" ? { type: "prefix.literal" } : null,
      };
    return {
      mode: {
        kind: "prefix",
        returnTo: mode.kind === "insert" ? "insert" : "normal",
      },
      action: null,
    };
  }
  if (mode.kind === "normal" && key.toLowerCase() === "ctrl-w")
    return { mode: { kind: "normal", pending: "Ctrl-w" }, action: null };
  if (mode.kind === "normal" && mode.pending === "Ctrl-w") {
    const action =
      key === "w"
        ? ({ type: "pane.next" } as const)
        : (BINDINGS.find(
            (b) =>
              b.modes.includes("prefix") &&
              b.action.type === "pane.focus" &&
              b.keys.split(" / ").includes(key),
          )?.action ?? null);
    return { mode: normal, action };
  }
  if (mode.kind === "normal" && key === "Z")
    return { mode: { kind: "normal", pending: "Z" }, action: null };
  if (mode.kind === "normal" && mode.pending === "Z" && key === "Q")
    return { mode: normal, action: { type: "tab.close" } };
  if (mode.kind === "normal" && key === "g" && mode.pending !== "g")
    return { mode: { kind: "normal", pending: "g" }, action: null };
  if (
    mode.kind === "normal" &&
    mode.pending === "g" &&
    (key === "t" || key === "T")
  )
    return {
      mode: normal,
      action: { type: "tab.cycle", delta: key === "t" ? 1 : -1 },
    };
  const candidate =
    mode.kind === "normal" && mode.pending === "g" && key === "g" ? "g g" : key;
  const binding = BINDINGS.find(
    (b) =>
      !b.inert &&
      b.modes.includes(mode.kind) &&
      (!b.context || b.context === context) &&
      b.keys
        .split(" / ")
        .some(
          (k) =>
            k === candidate ||
            (stroke.ctrl && k.toLowerCase() === candidate.toLowerCase()),
        ),
  );
  const action = binding?.action ?? null;
  return {
    mode:
      action?.type === "search.start"
        ? { kind: "search", query: "" }
        : action?.type === "copy.start"
          ? { kind: "copy" }
          : action?.type === "hint.start"
            ? { kind: "hint" }
            : action?.type === "insert"
              ? { kind: "insert" }
              : action?.type === "normal"
                ? normal
                : mode.kind === "prefix" &&
                    mode.returnTo === "insert" &&
                    action?.type !== "pane.numbers"
                  ? { kind: "insert" }
                  : mode.kind === "insert"
                    ? mode
                    : normal,
    action,
  };
}
/** Ctrl-C leaves whatever input or transient mode is active; only normal mode arms quit. */
/** The mode the Command Center restores when it closes. */
export function paletteReturnMode(mode: Mode): Mode {
  if (mode.kind === "prefix")
    return mode.returnTo === "insert"
      ? { kind: "insert" }
      : { kind: "normal", pending: "" };
  if (mode.kind === "copy") return { kind: "normal", pending: "" };
  return mode;
}
export function interrupt(mode: Mode): { mode: Mode; action: Action | null } {
  const normal: Mode = { kind: "normal", pending: "" };
  switch (mode.kind) {
    case "normal":
      return { mode: normal, action: { type: "quit" } };
    case "insert":
      return { mode: normal, action: { type: "normal" } };
    case "search":
      return { mode: normal, action: { type: "search.cancel" } };
    case "copy":
      return { mode: normal, action: { type: "copy.exit" } };
    case "hint":
      return { mode: normal, action: { type: "hint.cancel" } };
    case "palette":
      return { mode: normal, action: { type: "palette.close" } };
    case "prefix":
      return {
        mode: normal,
        action: mode.returnTo === "insert" ? { type: "normal" } : null,
      };
  }
}
/**
 * Actions that only make sense as in-context keystrokes, never as Command Center entries.
 * File hints label what is on screen, which the Command Center covers; it lists the chat's
 * files itself ("Open file from this chat…").
 */
const KEYSTROKE_ONLY: ReadonlySet<Action["type"]> = new Set([
  "quit",
  "insert",
  "normal",
  "palette.open",
  "palette.close",
  "copy.exit",
  "copy.key",
  "hint.start",
  "hint.key",
  "hint.cancel",
  "list.move",
  "list.edge",
  "list.open",
  "scroll.lines",
  "scroll.edge",
  "scroll.half",
  "scroll.page",
  "block.move",
  "block.toggle",
  "search.start",
  "search.update",
  "search.commit",
  "search.cancel",
  "search.next",
  "prefix.literal",
  "pane.select",
]);
export interface PaletteAction {
  action: Action;
  title: string;
  shortcut: string;
}
/** Command Center actions derived from BINDINGS, one per distinct action with all of its shortcuts. */
export function paletteActions(prefixLabel: string): PaletteAction[] {
  const entries = new Map<string, PaletteAction>();
  for (const binding of BINDINGS) {
    if (KEYSTROKE_ONLY.has(binding.action.type)) continue;
    const shortcut = binding.modes.includes("prefix")
      ? `${prefixLabel} ${binding.keys}`
      : binding.keys;
    const key = JSON.stringify(binding.action);
    const entry = entries.get(key);
    if (entry) entry.shortcut = `${entry.shortcut} / ${shortcut}`;
    else
      entries.set(key, {
        action: binding.action,
        title: binding.description,
        shortcut,
      });
  }
  return [...entries.values()];
}
export function bindingSection(binding: Binding, prefixLabel: string) {
  if (binding.modes.includes("prefix")) return prefixLabel;
  if (binding.modes.every((mode) => mode === "copy")) return "copy mode";
  return binding.context ?? "any";
}
export function helpRows(prefixLabel: string) {
  return [
    {
      section: "terminal input",
      keys: "Ctrl-]",
      description: "Return to TUI shortcuts (all other keys go to shell)",
    },
    {
      section: "agent question",
      keys: "↑↓ / j k · 1-9",
      description: "Move / pick an option (Other opens a text answer)",
    },
    {
      section: "agent question",
      keys: "Space · Tab / ←→",
      description: "Toggle a multi-select option · switch question",
    },
    {
      section: "agent question",
      keys: "Enter · Esc",
      description: "Next question or submit · cancel (deny) the question",
    },
    ...BINDINGS.map((b) => ({
      section: bindingSection(b, prefixLabel),
      keys: b.keys,
      description: b.description,
    })),
    { section: "input popups", keys: "Esc", description: "Back / close popup" },
    {
      section: "shortcut search",
      keys: "Esc",
      description: "Clear search, then close",
    },
    {
      section: "shortcut search",
      keys: "Tab",
      description: "Focus search / results",
    },
    {
      section: "shortcut search",
      keys: "q",
      description: "Close on empty results focus",
    },
  ];
}

export function parsePrefix(value: string): Stroke {
  if (!/^C-[a-z]$/i.test(value))
    throw new Error("--prefix must be C-<letter> (for example C-a)");
  const name = value.slice(2).toLowerCase();
  return {
    name,
    ctrl: true,
    meta: false,
    shift: false,
    sequence: String.fromCharCode(name.charCodeAt(0) - 96),
  };
}
