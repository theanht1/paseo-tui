import { BINDINGS } from "./bindings.js";
import { actionId } from "./key-overrides.js";
export interface Stroke {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** Command on macOS; only reported by terminals speaking the kitty keyboard protocol. */
  super?: boolean;
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
        /** Quits at once; the Command Center's Quit (the key needs Ctrl-C twice). */
        | "exit"
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
        | "tab.close"
        | "attention.next"
        | "sidebar.toggleGrouping"
        | "diff.open"
        | "workspace.editor"
        | "history.open"
        | "agent.unarchive"
        /** Opens the Jump to prompt list for the focused agent. */
        | "prompts.open"
        | "queue.send"
        | "queue.interrupt"
        | "queue.edit"
        | "queue.remove"
        | "queue.clear";
    }
  | { type: "queue.select"; delta: number }
  /** Scrolls the pane to the prompt at `seq` (from the prompt index of `epoch`). */
  | { type: "timeline.goto"; seq: number; epoch: string }
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
  | { type: "tab.cycle" | "workspace.cycle"; delta: number }
  | { type: "pane.select" | "tab.select" | "workspace.select"; index: number }
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
  /** Works in every mode, over popups too (New tab, Command Center). */
  global?: true;
}
function matches(binding: Binding, key: string, stroke: Stroke): boolean {
  return binding.keys
    .split(" / ")
    .some(
      (k) =>
        k === key || (stroke.ctrl && k.toLowerCase() === key.toLowerCase()),
    );
}
/** The always-on action a stroke triggers in any mode, if any. */
export function globalAction(
  stroke: Stroke,
  bindings: readonly Binding[] = BINDINGS,
): Action | null {
  const key = label(stroke);
  return (
    bindings.find((b) => b.global && !b.inert && matches(b, key, stroke))
      ?.action ?? null
  );
}
function label(stroke: Stroke): string {
  if (stroke.ctrl) return `Ctrl-${stroke.name.toLowerCase()}`;
  if (stroke.name === "tab" && stroke.shift) return "Shift-Tab";
  if (stroke.super) return `Super-${stroke.name}`;
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
  bindings: readonly Binding[] = BINDINGS,
): { mode: Mode; action: Action | null } {
  const key = label(stroke);
  const normal: Mode = { kind: "normal", pending: "" };
  if (key.toLowerCase() === "ctrl-c") return interrupt(mode);
  const always = globalAction(stroke, bindings);
  if (always)
    return {
      mode: always.type === "palette.open" ? { kind: "palette" } : normal,
      action: always,
    };
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
        : !stroke.ctrl &&
            !stroke.meta &&
            !stroke.super &&
            stroke.sequence.length === 1
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
        : (bindings.find(
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
    mode.kind === "normal" &&
    mode.pending === "g" &&
    (key === "g" || key === "d" || key === "e")
      ? `g ${key}`
      : key;
  const binding = bindings.find(
    (b) =>
      !b.inert &&
      b.modes.includes(mode.kind) &&
      (!b.context || b.context === context) &&
      matches(b, candidate, stroke),
  );
  const action = binding?.action ?? null;
  const entered = action ? actionMode(action) : null;
  return {
    mode:
      action?.type === "palette.open"
        ? { kind: "palette" }
        : (entered ??
          (action?.type === "normal"
            ? normal
            : mode.kind === "prefix" &&
                mode.returnTo === "insert" &&
                action?.type !== "pane.numbers"
              ? { kind: "insert" }
              : mode.kind === "insert"
                ? mode
                : normal)),
    action,
  };
}
/** The input mode an action starts, from a key or the Command Center; null when it starts none. */
export function actionMode(action: Action): Mode | null {
  switch (action.type) {
    case "search.start":
      return { kind: "search", query: "" };
    case "copy.start":
      return { kind: "copy" };
    case "hint.start":
      return { kind: "hint" };
    case "insert":
      return { kind: "insert" };
    default:
      return null;
  }
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
 * Actions that are keystrokes within another surface (the palette itself, copy and hint
 * keys, search typing), single-step moves the Command Center's own list replaces, or
 * ones it already lists as its own items (History…, Unarchive, Jump to prompt…, the
 * message queue's items).
 */
const KEYSTROKE_ONLY: ReadonlySet<Action["type"]> = new Set([
  "normal",
  "palette.open",
  "palette.close",
  "copy.exit",
  "copy.key",
  "hint.key",
  "hint.cancel",
  "list.move",
  "scroll.lines",
  "search.update",
  "search.commit",
  "search.cancel",
  "prefix.literal",
  "history.open",
  "agent.unarchive",
  "prompts.open",
  "timeline.goto",
  "queue.select",
  "queue.send",
  "queue.interrupt",
  "queue.edit",
  "queue.remove",
  "queue.clear",
]);
export interface PaletteAction {
  action: Action;
  title: string;
  shortcut: string;
  /** Words from the action's id, so "diff" finds "Open changes (lazygit)". */
  keywords: string[];
}
function actionKeywords(action: Action): string[] {
  return action.type
    .split(".")
    .flatMap((part) => part.split(/(?=[A-Z])/))
    .map((word) => word.toLowerCase());
}
/**
 * The keys that run `action` in the effective bindings, e.g. `g d` or `Ctrl-B z`;
 * Quit (`exit`) is the double Ctrl-C. Null when no key runs it.
 */
export function shortcutFor(
  action: Action,
  bindings: readonly Binding[],
  prefixLabel: string,
): string | null {
  const quit = action.type === "exit";
  const id = actionId(quit ? { type: "quit" } : action);
  const labels = bindings
    .filter((binding) => actionId(binding.action) === id)
    .map((binding) => {
      const keys = quit
        ? binding.keys
            .split(" / ")
            .map((key) => `${key} ${key}`)
            .join(" / ")
        : binding.keys;
      return binding.modes.includes("prefix") ? `${prefixLabel} ${keys}` : keys;
    });
  return labels.length ? [...new Set(labels)].join(" / ") : null;
}
/** Command Center actions derived from BINDINGS, one per distinct action with all of its shortcuts. */
export function paletteActions(
  prefixLabel: string,
  bindings: readonly Binding[] = BINDINGS,
): PaletteAction[] {
  const entries = new Map<string, PaletteAction>();
  for (const binding of bindings) {
    if (KEYSTROKE_ONLY.has(binding.action.type)) continue;
    const quit = binding.action.type === "quit";
    const action: Action = quit ? { type: "exit" } : binding.action;
    const key = actionId(action);
    if (entries.has(key)) continue;
    entries.set(key, {
      action,
      title: quit ? "Quit" : binding.description,
      shortcut: shortcutFor(action, bindings, prefixLabel) ?? "",
      keywords: quit ? ["quit", "exit", "close"] : actionKeywords(action),
    });
  }
  return [...entries.values()];
}
export function bindingSection(binding: Binding, prefixLabel: string) {
  if (binding.modes.includes("prefix")) return prefixLabel;
  if (binding.modes.every((mode) => mode === "copy")) return "copy mode";
  return binding.context ?? "any";
}
export function helpRows(
  prefixLabel: string,
  bindings: readonly Binding[] = BINDINGS,
) {
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
    ...bindings.map((b) => ({
      section: bindingSection(b, prefixLabel),
      keys: b.keys,
      description: b.description,
    })),
    { section: "input popups", keys: "Esc", description: "Back / close popup" },
    {
      section: "shortcut list",
      keys: "j k · Ctrl-d Ctrl-u · g g G",
      description: "Scroll · half page · top / bottom",
    },
    {
      section: "shortcut list",
      keys: "/ · Enter / Esc",
      description: "Search shortcuts · back to the list",
    },
    {
      section: "shortcut list",
      keys: "Esc · q",
      description: "Clear the search, then close · close",
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
