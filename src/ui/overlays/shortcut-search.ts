import {
  compareMatchScores,
  scoreTextFields,
} from "@getpaseo/protocol/search/text-match";
import { createEmitter } from "../../state/emitter.js";
import type { Stroke } from "../input/keymap.js";
export interface ShortcutRow {
  section: string;
  keys: string;
  description: string;
}
export function filterShortcuts(
  rows: readonly ShortcutRow[],
  query: string,
): ShortcutRow[] {
  return rows
    .flatMap((row) => {
      const score = scoreTextFields(
        query,
        [
          row.keys,
          row.description,
          row.section,
          row.description.replace(/\s+/g, ""),
        ],
        { typoTolerant: true },
      );
      return score ? [{ row, score }] : [];
    })
    .sort((a, b) => compareMatchScores(a.score, b.score))
    .map(({ row }) => row);
}
export type ShortcutScroll = {
  scroll: "line" | "half" | "page" | "edge";
  dir: 1 | -1;
};
/** Opens in normal mode (vim keys scroll the list); `/` or `i` types a filter. */
export function createShortcutSearch() {
  const emitter = createEmitter();
  let snapshot: { query: string; focus: "search" | "results" } = {
    query: "",
    focus: "results",
  };
  let pendingG = false;
  function change(query: string) {
    snapshot = { ...snapshot, query };
    emitter.notify();
  }
  function focus(target: "search" | "results") {
    snapshot = { ...snapshot, focus: target };
    emitter.notify();
  }
  function toggleFocus() {
    focus(snapshot.focus === "search" ? "results" : "search");
  }
  function normal(
    stroke: Stroke,
  ): "handled" | "close" | "pass" | ShortcutScroll {
    const g = pendingG;
    pendingG = false;
    if (stroke.ctrl) {
      const scroll: Record<string, ShortcutScroll> = {
        d: { scroll: "half", dir: 1 },
        u: { scroll: "half", dir: -1 },
        f: { scroll: "page", dir: 1 },
        b: { scroll: "page", dir: -1 },
        n: { scroll: "line", dir: 1 },
        p: { scroll: "line", dir: -1 },
        e: { scroll: "line", dir: 1 },
        y: { scroll: "line", dir: -1 },
      };
      return scroll[stroke.name] ?? "pass";
    }
    if (stroke.meta || stroke.super) return "pass";
    switch (stroke.name) {
      case "escape":
        if (!snapshot.query) return "close";
        change("");
        return "handled";
      case "tab":
        focus("search");
        return "handled";
      case "down":
        return { scroll: "line", dir: 1 };
      case "up":
        return { scroll: "line", dir: -1 };
      case "pagedown":
        return { scroll: "page", dir: 1 };
      case "pageup":
        return { scroll: "page", dir: -1 };
      case "home":
        return { scroll: "edge", dir: -1 };
      case "end":
        return { scroll: "edge", dir: 1 };
      case "space":
        return { scroll: "page", dir: 1 };
    }
    switch (stroke.sequence) {
      case "j":
        return { scroll: "line", dir: 1 };
      case "k":
        return { scroll: "line", dir: -1 };
      case "G":
        return { scroll: "edge", dir: 1 };
      case "g":
        if (g) return { scroll: "edge", dir: -1 };
        pendingG = true;
        return "handled";
      case "q":
        return "close";
      case "/":
      case "i":
        focus("search");
        return "handled";
    }
    // Other keys do nothing in normal mode rather than typing into the filter.
    return "handled";
  }
  function key(stroke: Stroke): "handled" | "close" | "pass" | ShortcutScroll {
    if (snapshot.focus === "results") return normal(stroke);
    if (
      stroke.name === "escape" ||
      stroke.name === "return" ||
      stroke.name === "tab" ||
      (stroke.ctrl && stroke.name === "c")
    ) {
      focus("results");
      return "handled";
    }
    return "pass";
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    change,
    focus,
    toggleFocus,
    key,
  };
}
