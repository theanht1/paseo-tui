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
  | { kind: "palette" };
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
        | "palette.open";
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
  | { type: "pane.select"; index: number }
  | { type: "search.update"; query: string }
  | { type: "search.next"; dir: 1 | -1 };
export interface Binding {
  keys: string;
  modes: Mode["kind"][];
  context?: Context;
  action: Action;
  description: string;
}
export const BINDINGS: readonly Binding[] = [
  {
    keys: "Shift-Tab",
    modes: ["normal"],
    context: "pane",
    action: { type: "agent.cycleMode" },
    description: "Cycle agent mode",
  },
  {
    keys: "Ctrl-K",
    modes: ["normal", "insert", "prefix", "search", "palette"],
    action: { type: "palette.open" },
    description: "Command Center",
  },
  {
    keys: ":",
    modes: ["normal", "prefix"],
    action: { type: "palette.open" },
    description: "Command Center",
  },
  {
    keys: "%",
    modes: ["prefix"],
    action: { type: "pane.split", direction: "right" },
    description: "Split right",
  },
  {
    keys: '"',
    modes: ["prefix"],
    action: { type: "pane.split", direction: "down" },
    description: "Split down",
  },
  ...(["left", "down", "up", "right"] as const).map(
    (direction, i): Binding => ({
      keys: ["h / Left", "j / Down", "k / Up", "l / Right"][i] ?? "",
      modes: ["prefix"],
      action: { type: "pane.focus", direction },
      description: `Focus ${direction}`,
    }),
  ),
  {
    keys: "o",
    modes: ["prefix"],
    action: { type: "pane.next" },
    description: "Next pane",
  },
  {
    keys: "x",
    modes: ["prefix"],
    action: { type: "pane.close" },
    description: "Close pane",
  },
  {
    keys: "z",
    modes: ["prefix"],
    action: { type: "pane.zoom" },
    description: "Zoom pane",
  },
  {
    keys: "q",
    modes: ["prefix"],
    action: { type: "pane.numbers" },
    description: "Show pane numbers",
  },
  ...Array.from(
    { length: 10 },
    (_, index): Binding => ({
      keys: String(index),
      modes: ["prefix"],
      action: { type: "pane.select", index },
      description: `Select pane ${index}`,
    }),
  ),
  {
    keys: "?",
    modes: ["prefix"],
    action: { type: "help" },
    description: "Help",
  },
  {
    keys: "/",
    modes: ["normal"],
    context: "pane",
    action: { type: "search.start" },
    description: "Search timeline",
  },
  {
    keys: "n",
    modes: ["normal"],
    context: "pane",
    action: { type: "search.next", dir: 1 },
    description: "Next match",
  },
  {
    keys: "N",
    modes: ["normal"],
    context: "pane",
    action: { type: "search.next", dir: -1 },
    description: "Previous match",
  },
  {
    keys: "\\",
    modes: ["normal"],
    action: { type: "sidebar.toggle" },
    description: "Toggle sidebar",
  },
  {
    keys: "q",
    modes: ["normal"],
    action: { type: "quit" },
    description: "Quit",
  },
  {
    keys: "Ctrl-C",
    modes: ["normal", "insert"],
    action: { type: "quit" },
    description: "Quit",
  },
  {
    keys: "?",
    modes: ["normal"],
    action: { type: "help" },
    description: "Help",
  },
  {
    keys: "Tab",
    modes: ["normal"],
    action: { type: "focus.toggleSidebar" },
    description: "Switch sidebar/pane",
  },
  {
    keys: "Ctrl-X",
    modes: ["normal"],
    action: { type: "stop" },
    description: "Stop running turn",
  },
  {
    keys: "j / Down",
    modes: ["normal"],
    context: "sidebar",
    action: { type: "list.move", delta: 1 },
    description: "Next agent",
  },
  {
    keys: "k / Up",
    modes: ["normal"],
    context: "sidebar",
    action: { type: "list.move", delta: -1 },
    description: "Previous agent",
  },
  {
    keys: "g g",
    modes: ["normal"],
    context: "sidebar",
    action: { type: "list.edge", edge: "top" },
    description: "First agent",
  },
  {
    keys: "G",
    modes: ["normal"],
    context: "sidebar",
    action: { type: "list.edge", edge: "bottom" },
    description: "Last agent",
  },
  {
    keys: "Enter / l",
    modes: ["normal"],
    context: "sidebar",
    action: { type: "list.open" },
    description: "Open agent",
  },
  {
    keys: "j / Down",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.lines", delta: 1 },
    description: "Scroll down",
  },
  {
    keys: "k / Up",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.lines", delta: -1 },
    description: "Scroll up",
  },
  {
    keys: "Ctrl-d",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.half", dir: 1 },
    description: "Half page down",
  },
  {
    keys: "Ctrl-u",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.half", dir: -1 },
    description: "Half page up",
  },
  {
    keys: "Ctrl-f / PgDn",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.page", dir: 1 },
    description: "Page down",
  },
  {
    keys: "Ctrl-b / PgUp",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.page", dir: -1 },
    description: "Page up",
  },
  {
    keys: "g g",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.edge", edge: "top" },
    description: "History top",
  },
  {
    keys: "G",
    modes: ["normal"],
    context: "pane",
    action: { type: "scroll.edge", edge: "bottom" },
    description: "Bottom and follow",
  },
  {
    keys: "{",
    modes: ["normal"],
    context: "pane",
    action: { type: "block.move", delta: -1 },
    description: "Previous block",
  },
  {
    keys: "}",
    modes: ["normal"],
    context: "pane",
    action: { type: "block.move", delta: 1 },
    description: "Next block",
  },
  {
    keys: "o / Enter",
    modes: ["normal"],
    context: "pane",
    action: { type: "block.toggle" },
    description: "Toggle block",
  },
  {
    keys: "O",
    modes: ["normal"],
    context: "pane",
    action: { type: "block.toggleAll" },
    description: "Expand/collapse all",
  },
  {
    keys: "i / a",
    modes: ["normal"],
    context: "pane",
    action: { type: "insert" },
    description: "Edit prompt",
  },
  {
    keys: "Esc",
    modes: ["normal"],
    context: "pane",
    action: { type: "focus.toggleSidebar" },
    description: "Focus sidebar",
  },
  {
    keys: "Esc",
    modes: ["insert"],
    action: { type: "normal" },
    description: "Leave insert mode",
  },
];
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
  if (key.toLowerCase() === "ctrl-c")
    return { mode: normal, action: { type: "quit" } };
  if (
    key.toLowerCase() === "ctrl-k" ||
    ((mode.kind === "normal" || mode.kind === "prefix") && key === ":")
  )
    return { mode: { kind: "palette" }, action: { type: "palette.open" } };
  if (mode.kind === "palette") return { mode, action: null };
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
  if (mode.kind === "normal" && key === "g" && mode.pending !== "g")
    return { mode: { kind: "normal", pending: "g" }, action: null };
  const candidate =
    mode.kind === "normal" && mode.pending === "g" && key === "g" ? "g g" : key;
  const binding = BINDINGS.find(
    (b) =>
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
export function helpRows(prefixLabel: string) {
  return BINDINGS.map((b) => ({
    section: b.modes.includes("prefix") ? prefixLabel : (b.context ?? "any"),
    keys: b.keys,
    description: b.description,
  }));
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
