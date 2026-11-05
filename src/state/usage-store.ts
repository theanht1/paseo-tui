import type { UsagePort, UsageReportEntry } from "../connection/ports.js";
import { createEmitter } from "./emitter.js";

export type UsageSnapshot =
  | { kind: "loading" }
  | { kind: "ready"; reports: readonly UsageReportEntry[] }
  | { kind: "error"; message: string; reports: readonly UsageReportEntry[] };
export interface UsageStore {
  getSnapshot(): UsageSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(options?: { force?: boolean }): Promise<void>;
  close(): void;
}

/** The daemon caches reports for five minutes, so a one-minute poll stays cheap. */
export const USAGE_POLL_MS = 60_000;

export function createUsageStore(
  port: UsagePort,
  intervalMs = USAGE_POLL_MS,
): UsageStore {
  const emitter = createEmitter();
  let snapshot: UsageSnapshot = { kind: "loading" };
  let closed = false;
  let inflight: Promise<void> | null = null;
  function reportsOf(current: UsageSnapshot) {
    return current.kind === "loading" ? [] : current.reports;
  }
  async function fetch(force: boolean) {
    try {
      const reports = await port.list(force ? { forceRefresh: true } : {});
      if (closed) return;
      snapshot = { kind: "ready", reports };
    } catch (error) {
      if (closed) return;
      snapshot = {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        reports: reportsOf(snapshot),
      };
    }
    emitter.notify();
  }
  function refresh(options: { force?: boolean } = {}): Promise<void> {
    if (closed) return Promise.resolve();
    if (inflight && !options.force) return inflight;
    const run = fetch(options.force === true).finally(() => {
      if (inflight === run) inflight = null;
    });
    inflight = run;
    return run;
  }
  const first = setTimeout(() => void refresh(), 0);
  const timer = setInterval(() => void refresh(), intervalMs);
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    refresh,
    close() {
      closed = true;
      clearTimeout(first);
      clearInterval(timer);
      emitter.clear();
    },
  };
}
