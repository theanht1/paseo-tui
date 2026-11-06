import type { Action, Binding } from "./keymap.js";

/**
 * Stable config name of an action: its type, then its arguments joined with `:`,
 * e.g. `help`, `tab.cycle:1`, `pane.split:right`, `pane.select:3`.
 */
export function actionId(action: Action): string {
  const { type, ...args } = action;
  return [type, ...Object.values(args).map(String)].join(":");
}

/** Actions dispatch handles as fixed chords or interrupts (Ctrl-C, Z Q, g t / g T). */
const FIXED: ReadonlySet<Action["type"]> = new Set([
  "quit",
  "normal",
  "tab.close",
  "tab.cycle",
]);

function rebindable(binding: Binding): boolean {
  return !binding.inert && !FIXED.has(binding.action.type);
}

/** Every action id the `keys` config may rebind, in table order. */
export function rebindableActions(defaults: readonly Binding[]): string[] {
  return [
    ...new Set(defaults.filter(rebindable).map((b) => actionId(b.action))),
  ];
}

const NAMED: Readonly<Record<string, string>> = {
  enter: "Enter",
  return: "Enter",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  pgdn: "PgDn",
  pagedown: "PgDn",
  pgup: "PgUp",
  pageup: "PgUp",
  home: "home",
  end: "end",
  insert: "insert",
  delete: "delete",
  backspace: "backspace",
  space: "space",
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `f${i + 1}`]),
  ),
};

function printable(char: string): boolean {
  return [...char].length === 1 && /^[!-~]$/u.test(char);
}

/** The key in the label format dispatch matches (see `label` in keymap.ts), or null. */
export function canonicalKey(input: string): string | null {
  const named = NAMED[input.toLowerCase()];
  if (named) return named;
  if (printable(input)) return input;
  if (/^shift-tab$/i.test(input)) return "Shift-Tab";
  const ctrl = /^(?:ctrl|c)-(.+)$/i.exec(input)?.[1];
  if (ctrl) {
    if (printable(ctrl)) return `Ctrl-${ctrl}`;
    const name = NAMED[ctrl.toLowerCase()];
    return name ? `Ctrl-${name}` : null;
  }
  const meta = /^(?:meta|alt|m)-(.+)$/i.exec(input)?.[1];
  if (meta && printable(meta)) return `Meta-${meta.toLowerCase()}`;
  const command = /^(?:super|cmd|command)-(.+)$/i.exec(input)?.[1];
  if (command && printable(command)) return `Super-${command.toLowerCase()}`;
  return null;
}

function sameKey(a: string, b: string): boolean {
  return a.startsWith("Ctrl-") && b.startsWith("Ctrl-")
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

function splitKeys(keys: string): string[] {
  return keys.split(" / ");
}

/** Keys dispatch reserves before reading the table. */
function reservation(key: string, binding: Binding): string | null {
  if (sameKey(key, "Ctrl-c")) return "is reserved";
  if (
    binding.modes.includes("normal") &&
    (key === "g" || key === "Z" || sameKey(key, "Ctrl-w"))
  )
    return "is reserved in normal mode";
  return null;
}

/** Bindings that also run while typing need keys a text input never consumes. */
function typed(key: string, binding: Binding): boolean {
  const textModes = binding.modes.some(
    (mode) => mode === "insert" || mode === "search" || mode === "palette",
  );
  return (
    textModes &&
    !key.startsWith("Ctrl-") &&
    !key.startsWith("Meta-") &&
    !key.startsWith("Super-")
  );
}

function overlaps(a: Binding, b: Binding): boolean {
  return (
    a.modes.some((mode) => b.modes.includes(mode)) &&
    (!a.context || !b.context || a.context === b.context)
  );
}

/** A binding another earlier binding already covers (same action, keys, wider scope). */
function redundant(binding: Binding, earlier: readonly Binding[]): boolean {
  return earlier.some(
    (other) =>
      actionId(other.action) === actionId(binding.action) &&
      other.keys === binding.keys &&
      (!other.context || other.context === binding.context) &&
      binding.modes.every((mode) => other.modes.includes(mode)),
  );
}

export interface KeyOverrideResult {
  bindings: readonly Binding[];
  /** Human-readable problems; the bindings are only meaningful when this is empty. */
  errors: string[];
}

/**
 * Builds the effective binding table: each overridden action's default keys are
 * replaced by the configured keys (an empty list unbinds it); modes and context
 * stay those of the default binding.
 */
export function applyKeyOverrides(
  defaults: readonly Binding[],
  overrides: ReadonlyMap<string, readonly string[]>,
): KeyOverrideResult {
  const errors: string[] = [];
  const valid = rebindableActions(defaults);
  const fixed = new Set(defaults.map((b) => actionId(b.action)));
  const resolved = new Map<string, string[]>();
  for (const [id, keys] of overrides) {
    const where = `keys.${JSON.stringify(id)}`;
    if (!valid.includes(id)) {
      errors.push(
        fixed.has(id)
          ? `${where}: not rebindable (fixed chord)`
          : `${where}: unknown action; valid: ${valid.join(", ")}`,
      );
      continue;
    }
    const scopes = defaults.filter(
      (b) => rebindable(b) && actionId(b.action) === id,
    );
    const canonical: string[] = [];
    for (const raw of keys) {
      const input = raw.trim();
      if (/\s/.test(input)) {
        errors.push(
          `${where}: ${JSON.stringify(raw)} is a multi-key chord; only single keys can be bound`,
        );
        continue;
      }
      const key = canonicalKey(input);
      if (key === null) {
        errors.push(
          `${where}: ${JSON.stringify(raw)} is not a key (use e.g. x, X, Ctrl-x, Meta-x, Cmd-x, Enter, Esc, Tab, Shift-Tab, Up, PgDn, F1)`,
        );
        continue;
      }
      const problem = scopes
        .map(
          (binding) =>
            reservation(key, binding) ??
            (typed(key, binding)
              ? "would be typed as text; use a Ctrl-, Meta- or Cmd- key"
              : null),
        )
        .find((message) => message !== null);
      if (problem) {
        errors.push(`${where}: ${JSON.stringify(key)} ${problem}`);
        continue;
      }
      canonical.push(key);
    }
    resolved.set(id, canonical);
  }
  const bindings: Binding[] = [];
  for (const binding of defaults) {
    const keys = rebindable(binding)
      ? resolved.get(actionId(binding.action))
      : undefined;
    if (keys === undefined) bindings.push(binding);
    else if (keys.length > 0) {
      const next = { ...binding, keys: keys.join(" / ") };
      if (!redundant(next, bindings)) bindings.push(next);
    }
  }
  for (const binding of bindings) {
    const id = actionId(binding.action);
    if (!resolved.has(id)) continue;
    for (const key of splitKeys(binding.keys)) {
      const other = bindings.find(
        (b) =>
          !b.inert &&
          actionId(b.action) !== id &&
          overlaps(b, binding) &&
          splitKeys(b.keys).some((k) => sameKey(k, key)),
      );
      const mode = other?.modes.find((m) => binding.modes.includes(m));
      if (other && mode)
        errors.push(
          `keys.${JSON.stringify(id)}: ${JSON.stringify(key)} conflicts with ${actionId(other.action)} in ${mode} mode`,
        );
    }
  }
  return { bindings, errors: [...new Set(errors)] };
}
