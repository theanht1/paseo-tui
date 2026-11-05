import { createEmitter } from "../../state/emitter.js";
import type { TimelineRow, TimelineStore } from "../../state/timeline-store.js";
import type { Block } from "./blocks.js";

/** The daemon's full-history search for the active query. */
export type HistoryState =
  | { kind: "off" }
  | { kind: "searching"; query: string }
  | {
      kind: "done";
      query: string;
      epoch: string;
      seqs: readonly number[];
      truncated: boolean;
    }
  | { kind: "failed"; query: string; message: string };
/** A match on screen (block key) or one the pane must page in first. */
export type SearchTarget =
  | { kind: "loaded"; key: string }
  | { kind: "unloaded"; seq: number };

/**
 * Loaded matches in block order, merged with the daemon's matches. Daemon matches
 * outside the loaded rows come first when older and last when newer.
 */
export function combineMatches(input: {
  blocks: readonly Block[];
  owners: ReadonlyMap<number, string>;
  rows: readonly TimelineRow[];
  epoch: string | null;
  local: readonly string[];
  history: HistoryState;
}): SearchTarget[] {
  const { history, rows } = input;
  const keys = new Set(input.local);
  const older: SearchTarget[] = [];
  const newer: SearchTarget[] = [];
  if (history.kind === "done" && history.epoch === input.epoch) {
    const first = rows[0]?.seq ?? Infinity;
    const last = rows.at(-1)?.seq ?? -Infinity;
    for (const seq of history.seqs) {
      if (seq < first) older.push({ kind: "unloaded", seq });
      else if (seq > last) newer.push({ kind: "unloaded", seq });
      else {
        const key = input.owners.get(seq);
        if (key) keys.add(key);
      }
    }
  }
  const loaded: SearchTarget[] = input.blocks
    .filter((block) => keys.has(block.key))
    .map((block) => ({ kind: "loaded", key: block.key }));
  return [...older, ...loaded, ...newer];
}

/** The current match: the pending page-in wins over the selected block; -1 for none. */
export function targetIndex(
  targets: readonly SearchTarget[],
  selectedKey: string | null,
  pending: number | null,
): number {
  return targets.findIndex((target) =>
    pending === null
      ? target.kind === "loaded" && target.key === selectedKey
      : target.kind === "unloaded" && target.seq === pending,
  );
}

export function nextTarget(
  targets: readonly SearchTarget[],
  index: number,
  dir: 1 | -1,
): SearchTarget | null {
  const next =
    index < 0
      ? dir === 1
        ? 0
        : targets.length - 1
      : (index + dir + targets.length) % targets.length;
  return targets[next] ?? null;
}

export function searchStatus(input: {
  query: string;
  targets: readonly SearchTarget[];
  index: number;
  history: HistoryState;
  notice: string | null;
}): string {
  const { history, targets } = input;
  if (!input.query) return "";
  const notes = [
    history.kind === "searching" ? "searching history…" : null,
    history.kind === "failed"
      ? `history search failed: ${history.message}`
      : null,
    input.notice,
  ].filter((note) => note !== null);
  const more = history.kind === "done" && history.truncated ? "+" : "";
  const count = targets.length
    ? `match ${Math.max(0, input.index) + 1}/${targets.length}${more}`
    : history.kind === "searching"
      ? null
      : "no match";
  return [count, ...notes].filter((part) => part !== null).join(" · ");
}

interface HistorySearchSnapshot {
  history: HistoryState;
  /** Sequence of an unloaded match being paged in. */
  pending: number | null;
  notice: string | null;
}
/** Runs daemon searches for one pane, dropping answers to superseded queries. */
export function createHistorySearch(search: TimelineStore["search"]) {
  const emitter = createEmitter();
  let snapshot: HistorySearchSnapshot = {
    history: { kind: "off" },
    pending: null,
    notice: null,
  };
  let generation = 0;
  function publish(next: Partial<HistorySearchSnapshot>) {
    snapshot = { ...snapshot, ...next };
    emitter.notify();
  }
  function message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    run(query: string) {
      const current = ++generation;
      if (!search || !query) {
        publish({ history: { kind: "off" }, pending: null, notice: null });
        return;
      }
      publish({
        history: { kind: "searching", query },
        pending: null,
        notice: null,
      });
      search.find(query).then(
        (result) => {
          if (current === generation)
            publish({ history: { kind: "done", query, ...result } });
        },
        (error: unknown) => {
          if (current === generation)
            publish({
              history: { kind: "failed", query, message: message(error) },
            });
        },
      );
    },
    reveal(seq: number) {
      if (!search) return;
      publish({ pending: seq, notice: null });
      search.reveal(seq).catch((error: unknown) => {
        if (snapshot.pending === seq)
          publish({ pending: null, notice: message(error) });
      });
    },
    /** The pending match is on screen now. */
    shown() {
      publish({ pending: null });
    },
  };
}
