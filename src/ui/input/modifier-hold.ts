import { createEmitter } from "../../state/emitter.js";
import type { ExternalStore } from "../use-store.js";

export type Modifier = "shift" | "ctrl" | "alt" | "super" | "hyper" | "meta";
/** Kitty keyboard codepoints of the left and right modifier keys (reported with "all keys as escapes"). */
const MODIFIER_KEYS: Readonly<Record<number, Modifier>> = {
  57441: "shift",
  57442: "ctrl",
  57443: "alt",
  57444: "super",
  57445: "hyper",
  57446: "meta",
  57447: "shift",
  57448: "ctrl",
  57449: "alt",
  57450: "super",
  57451: "hyper",
  57452: "meta",
};
const ESC = "\u001b";
/** A modifier key pressed or released on its own, or null for any other input. */
export function modifierKey(
  sequence: string,
): { modifier: Modifier; down: boolean } | null {
  if (!sequence.startsWith(ESC)) return null;
  const match = /^\[(\d+)(?:;\d*(?::(\d))?)?u$/.exec(sequence.slice(1));
  const modifier = match ? MODIFIER_KEYS[Number(match[1])] : undefined;
  if (!match || !modifier) return null;
  return { modifier, down: match[2] !== "3" };
}
/** How long the modifier must stay down before hints appear, so quick chords don't flash them. */
const HINT_DELAY_MS = 150;
export type Schedule = (run: () => void, ms: number) => () => void;
const timer: Schedule = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};
export interface ModifierHold extends ExternalStore<boolean> {
  /** A raw input handler: swallows modifier-only keys so they never reach inputs or terminals. */
  input(sequence: string): boolean;
  reset(): void;
}
/** Whether one of `watched` is being held, for showing jump-by-position hints. */
export function createModifierHold(
  watched: readonly Modifier[],
  schedule: Schedule = timer,
): ModifierHold {
  const emitter = createEmitter();
  let shown = false;
  let cancel: (() => void) | null = null;
  function show(next: boolean) {
    if (shown === next) return;
    shown = next;
    emitter.notify();
  }
  function reset() {
    cancel?.();
    cancel = null;
    show(false);
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => shown,
    input(sequence) {
      const key = modifierKey(sequence);
      if (!key) return false;
      if (!watched.includes(key.modifier)) return true;
      if (!key.down) reset();
      else if (!shown && !cancel)
        cancel = schedule(() => {
          cancel = null;
          show(true);
        }, HINT_DELAY_MS);
      return true;
    },
    reset,
  };
}
