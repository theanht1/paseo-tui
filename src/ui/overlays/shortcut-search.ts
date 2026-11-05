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
export function createShortcutSearch() {
  const emitter = createEmitter();
  let snapshot: { query: string; focus: "search" | "results" } = {
    query: "",
    focus: "search",
  };
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
  function handleEscape(): "handled" | "close" {
    if (snapshot.query) {
      change("");
      return "handled";
    }
    return "close";
  }
  function key(stroke: Stroke): "handled" | "close" | "pass" {
    if (stroke.name === "escape") return handleEscape();
    if (stroke.ctrl && stroke.name === "c") {
      if (snapshot.focus === "results") return "pass";
      focus("results");
      return "handled";
    }
    if (stroke.name === "tab") {
      toggleFocus();
      return "handled";
    }
    if (
      snapshot.focus === "results" &&
      !stroke.ctrl &&
      !stroke.meta &&
      stroke.sequence.length === 1
    ) {
      if (!snapshot.query && stroke.sequence === "q") return "close";
      change(snapshot.query + stroke.sequence);
      focus("search");
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
    escape: handleEscape,
    key,
  };
}
