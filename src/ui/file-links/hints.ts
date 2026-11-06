/** Home row first, then the rest of the keyboard by reach. */
const ALPHABET = "asdfjkl;ghqweruiopzxcvbnmty";

/** Prefix-free labels: single letters while they suffice, otherwise all two-letter. */
export function hintLabels(count: number): string[] {
  const letters = [...ALPHABET];
  if (count <= letters.length) return letters.slice(0, count);
  return letters
    .flatMap((first) => letters.map((second) => first + second))
    .slice(0, count);
}

export interface HintSpot<T> {
  row: number;
  col: number;
  /** Spots with the same key share one label. */
  key: string;
  value: T;
}
export interface HintTarget<T> extends HintSpot<T> {
  label: string;
}
export interface HintState<T> {
  targets: readonly HintTarget<T>[];
  typed: string;
}
export type HintEffect<T> =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "open"; value: T };

/** Labels are assigned in reading order (top-to-bottom, then left-to-right). */
export function assignHints<T>(spots: readonly HintSpot<T>[]): HintTarget<T>[] {
  const ordered = [...spots].sort((a, b) => a.row - b.row || a.col - b.col);
  const keys = [...new Set(ordered.map((spot) => spot.key))];
  const labels = hintLabels(keys.length);
  const byKey = new Map(keys.map((key, index) => [key, labels[index] ?? ""]));
  return ordered.map((spot) => ({ ...spot, label: byKey.get(spot.key) ?? "" }));
}

export function hintKey<T>(
  state: HintState<T>,
  key: string,
): { state: HintState<T>; effect: HintEffect<T> } {
  if (key === "Esc" || key === "Ctrl-c")
    return { state, effect: { kind: "cancel" } };
  if (key === "backspace")
    return {
      state: { ...state, typed: state.typed.slice(0, -1) },
      effect: { kind: "none" },
    };
  const typed = state.typed + key;
  if (!state.targets.some((target) => target.label.startsWith(typed)))
    return { state, effect: { kind: "none" } };
  const hit = state.targets.find((target) => target.label === typed);
  return {
    state: { ...state, typed },
    effect: hit ? { kind: "open", value: hit.value } : { kind: "none" },
  };
}

/** Links `find` reports in screen rows (starting at `origin`), with screen positions. */
export function screenSpots<T>(
  rows: readonly string[],
  origin: { x: number; y: number },
  find: (text: string) => readonly { start: number; raw: string; value: T }[],
): HintSpot<T>[] {
  return rows.flatMap((text, offset) =>
    find(text).map((span) => ({
      row: origin.y + offset,
      col: origin.x + Array.from(text.slice(0, span.start)).length,
      key: span.raw,
      value: span.value,
    })),
  );
}
