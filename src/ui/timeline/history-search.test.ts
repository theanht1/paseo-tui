import { describe, expect, it } from "vitest";
import type { TimelineSearchResult } from "../../connection/ports.js";
import type { TimelineRow } from "../../state/timeline-store.js";
import { toBlocks } from "./blocks.js";
import {
  combineMatches,
  createHistorySearch,
  createRevealTracker,
  type HistoryState,
  nextTarget,
  searchStatus,
  targetIndex,
} from "./history-search.js";
import { findMatches } from "./search.js";

function user(seq: number, text: string): TimelineRow {
  return { seq, timestamp: "t", item: { type: "user_message", text } };
}
function assistant(seq: number, text: string): TimelineRow {
  return { seq, timestamp: "t", item: { type: "assistant_message", text } };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const rows = [
  user(10, "find the needle"),
  assistant(11, "a nee"),
  assistant(12, "dle split across chunks"),
  user(13, "nothing here"),
  assistant(14, "needle again"),
];
function combine(history: HistoryState, query = "needle") {
  const owners = new Map<number, string>();
  const blocks = toBlocks(rows, owners);
  return combineMatches({
    blocks,
    owners,
    rows,
    epoch: "e",
    local: findMatches(blocks, query),
    history,
  });
}

describe("combined matches", () => {
  it("orders older daemon matches before loaded ones and merges duplicates", () => {
    expect(
      combine({
        kind: "done",
        query: "needle",
        epoch: "e",
        seqs: [2, 7, 10, 12, 14],
        truncated: false,
      }),
    ).toEqual([
      { kind: "unloaded", seq: 2 },
      { kind: "unloaded", seq: 7 },
      { kind: "loaded", key: "user:10" },
      { kind: "loaded", key: "assistant:11" },
      { kind: "loaded", key: "assistant:14" },
    ]);
  });
  it("uses only loaded matches until the daemon answers, or when history changed", () => {
    const loaded = [
      { kind: "loaded", key: "user:10" },
      { kind: "loaded", key: "assistant:11" },
      { kind: "loaded", key: "assistant:14" },
    ];
    expect(combine({ kind: "searching", query: "needle" })).toEqual(loaded);
    expect(
      combine({
        kind: "done",
        query: "needle",
        epoch: "old",
        seqs: [2],
        truncated: false,
      }),
    ).toEqual(loaded);
  });
});

describe("search status", () => {
  const targets = combine({
    kind: "done",
    query: "needle",
    epoch: "e",
    seqs: [2, 10],
    truncated: true,
  });
  it("counts every match and marks truncated history", () => {
    expect(
      searchStatus({
        query: "needle",
        targets,
        index: targetIndex(targets, "user:10", null),
        history: {
          kind: "done",
          query: "needle",
          epoch: "e",
          seqs: [2, 10],
          truncated: true,
        },
        notice: null,
      }),
    ).toBe("match 2/4+");
  });
  it("reports progress, failures and empty results", () => {
    const base = { query: "x", targets: [], index: -1, notice: null };
    expect(searchStatus({ ...base, query: "", history: { kind: "off" } })).toBe(
      "",
    );
    expect(
      searchStatus({ ...base, history: { kind: "searching", query: "x" } }),
    ).toBe("searching history…");
    expect(searchStatus({ ...base, history: { kind: "off" } })).toBe(
      "no match",
    );
    expect(
      searchStatus({
        ...base,
        targets,
        index: 0,
        history: { kind: "failed", query: "x", message: "Agent not found" },
      }),
    ).toBe("match 1/4 · history search failed: Agent not found");
    expect(
      searchStatus({
        ...base,
        targets,
        index: 0,
        history: { kind: "off" },
        notice: "That message is no longer in the history",
      }),
    ).toBe("match 1/4 · That message is no longer in the history");
  });
});

describe("navigation", () => {
  const targets = [
    { kind: "unloaded" as const, seq: 2 },
    { kind: "loaded" as const, key: "user:10" },
  ];
  it("finds the current target by selected key or pending sequence", () => {
    expect(targetIndex(targets, "user:10", null)).toBe(1);
    expect(targetIndex(targets, "user:10", 2)).toBe(0);
    expect(targetIndex(targets, "other", null)).toBe(-1);
  });
  it("wraps in both directions and starts at an edge", () => {
    expect(nextTarget(targets, 1, 1)).toEqual(targets[0]);
    expect(nextTarget(targets, 0, -1)).toEqual(targets[1]);
    expect(nextTarget(targets, -1, 1)).toEqual(targets[0]);
    expect(nextTarget(targets, -1, -1)).toEqual(targets[1]);
    expect(nextTarget([], -1, 1)).toBeNull();
  });
});

describe("history search controller", () => {
  it("is off without daemon search", () => {
    const search = createHistorySearch(null);
    search.run("needle");
    expect(search.getSnapshot().history).toEqual({ kind: "off" });
  });
  it("runs the query, keeping only the latest answer", async () => {
    const answers: ReturnType<typeof deferred<TimelineSearchResult>>[] = [];
    const reveals: number[] = [];
    const search = createHistorySearch({
      find: () => {
        const next = deferred<TimelineSearchResult>();
        answers.push(next);
        return next.promise;
      },
      reveal: async (seq) => {
        reveals.push(seq);
      },
    });
    search.run("old");
    search.run("needle");
    expect(search.getSnapshot().history).toEqual({
      kind: "searching",
      query: "needle",
    });
    answers[1]?.resolve({ epoch: "e", seqs: [3], truncated: false });
    answers[0]?.resolve({ epoch: "e", seqs: [9], truncated: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(search.getSnapshot().history).toEqual({
      kind: "done",
      query: "needle",
      epoch: "e",
      seqs: [3],
      truncated: false,
    });
    search.run("");
    expect(search.getSnapshot().history).toEqual({ kind: "off" });
  });
  it("records failures, and reveals a match until it is shown", async () => {
    const search = createHistorySearch({
      find: async () => {
        throw Error("Agent not found");
      },
      reveal: async (seq) => {
        if (seq === 1) throw Error("That message is no longer in the history");
      },
    });
    search.run("x");
    await Promise.resolve();
    await Promise.resolve();
    expect(search.getSnapshot().history).toEqual({
      kind: "failed",
      query: "x",
      message: "Agent not found",
    });
    search.reveal(5);
    expect(search.getSnapshot().pending).toBe(5);
    search.shown();
    expect(search.getSnapshot().pending).toBeNull();
    search.reveal(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(search.getSnapshot()).toMatchObject({
      pending: null,
      notice: "That message is no longer in the history",
    });
  });
});

describe("reveal tracker", () => {
  it("does nothing without history paging", () => {
    const tracker = createRevealTracker(null);
    tracker.reveal(3);
    expect(tracker.getSnapshot()).toEqual({ pending: null, notice: null });
  });
  it("tracks the pending sequence until it is shown", () => {
    const reveals: number[] = [];
    const tracker = createRevealTracker(async (seq) => {
      reveals.push(seq);
    });
    tracker.reveal(5);
    expect(tracker.getSnapshot()).toEqual({ pending: 5, notice: null });
    tracker.shown();
    expect(tracker.getSnapshot().pending).toBeNull();
    expect(reveals).toEqual([5]);
  });
  it("reports a failed reveal only while that sequence is still pending", async () => {
    const pages = [deferred<void>(), deferred<void>()];
    let call = 0;
    const tracker = createRevealTracker(
      () => pages[call++]?.promise ?? Promise.resolve(),
    );
    tracker.reveal(1);
    tracker.reveal(2);
    pages[0]?.reject(Error("stale"));
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.getSnapshot()).toEqual({ pending: 2, notice: null });
    pages[1]?.reject(Error("That message is no longer in the history"));
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.getSnapshot()).toEqual({
      pending: null,
      notice: "That message is no longer in the history",
    });
    tracker.notify("History changed; reopen the prompt list");
    expect(tracker.getSnapshot().notice).toBe(
      "History changed; reopen the prompt list",
    );
  });
  it("feeds the search snapshot, so search matches and prompt jumps share one page-in", () => {
    const tracker = createRevealTracker(async () => {});
    const search = createHistorySearch(
      {
        find: async () => ({ epoch: "e", seqs: [], truncated: false }),
        reveal: async () => {},
      },
      tracker,
    );
    tracker.reveal(7);
    expect(search.getSnapshot().pending).toBe(7);
    search.shown();
    expect(tracker.getSnapshot().pending).toBeNull();
  });
});
