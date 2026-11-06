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
  if (!input.query) return input.notice ?? "";
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

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
interface RevealSnapshot {
  /** Sequence of an unloaded row being paged in. */
  pending: number | null;
  notice: string | null;
}
/**
 * One pane's page-in of an unloaded row (a search match or a prompt jump): the
 * pane jumps once `pending` is loaded and calls `shown`.
 */
export function createRevealTracker(
  reveal: ((seq: number) => Promise<void>) | null,
) {
  const emitter = createEmitter();
  let snapshot: RevealSnapshot = { pending: null, notice: null };
  function publish(next: Partial<RevealSnapshot>) {
    snapshot = { ...snapshot, ...next };
    emitter.notify();
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    reveal(seq: number) {
      if (!reveal) return;
      publish({ pending: seq, notice: null });
      reveal(seq).catch((error: unknown) => {
        if (snapshot.pending === seq)
          publish({ pending: null, notice: message(error) });
      });
    },
    /** The pending row is on screen now. */
    shown() {
      publish({ pending: null });
    },
    /** Drops any pending page-in and shows `text` instead. */
    notify(text: string) {
      publish({ pending: null, notice: text });
    },
    reset() {
      if (snapshot.pending !== null || snapshot.notice !== null)
        publish({ pending: null, notice: null });
    },
  };
}
export type RevealTracker = ReturnType<typeof createRevealTracker>;

interface HistorySearchSnapshot extends RevealSnapshot {
  history: HistoryState;
}
/** Runs daemon searches for one pane, dropping answers to superseded queries. */
export function createHistorySearch(
  search: TimelineStore["search"],
  tracker: RevealTracker = createRevealTracker(search?.reveal ?? null),
) {
  const emitter = createEmitter();
  let history: HistoryState = { kind: "off" };
  let snapshot: HistorySearchSnapshot = { history, ...tracker.getSnapshot() };
  let generation = 0;
  function refresh() {
    snapshot = { history, ...tracker.getSnapshot() };
    emitter.notify();
  }
  tracker.subscribe(refresh);
  function publish(next: HistoryState) {
    history = next;
    refresh();
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    run(query: string) {
      const current = ++generation;
      tracker.reset();
      if (!search || !query) {
        publish({ kind: "off" });
        return;
      }
      publish({ kind: "searching", query });
      search.find(query).then(
        (result) => {
          if (current === generation)
            publish({ kind: "done", query, ...result });
        },
        (error: unknown) => {
          if (current === generation)
            publish({ kind: "failed", query, message: message(error) });
        },
      );
    },
    reveal: tracker.reveal,
    /** The pending match is on screen now. */
    shown: tracker.shown,
  };
}
