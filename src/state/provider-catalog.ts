import type {
  ProviderCatalogPort,
  ProviderSnapshotEntry,
} from "../connection/ports.js";
import { createEmitter } from "./emitter.js";

export type ProviderEntry = ProviderSnapshotEntry;
export type ProviderCatalogSnapshot =
  | { kind: "loading" }
  | { kind: "ready"; entries: readonly ProviderEntry[] }
  | { kind: "error"; message: string };
/** One host's provider snapshot, loaded once and kept live by the daemon's pushes. */
export interface ProviderCatalog {
  getSnapshot(): ProviderCatalogSnapshot;
  subscribe(listener: () => void): () => void;
  /** The entries once loaded; retries a failed load. */
  entries(): Promise<readonly ProviderEntry[]>;
  /** Refetches the snapshot, e.g. after a reconnect. */
  load(): Promise<void>;
  /** Asks the daemon to rediscover providers; the result arrives as an update. */
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export function createProviderCatalog(
  port: ProviderCatalogPort,
): ProviderCatalog {
  const emitter = createEmitter();
  let snapshot: ProviderCatalogSnapshot = { kind: "loading" };
  /** Bumped by each applied update, so a response that started earlier is stale. */
  let version = 0;
  let inflight: Promise<void> | null = null;
  let closed = false;
  /** Unchanged providers keep their entry object, so per-entry memos stay valid. */
  function apply(entries: readonly ProviderEntry[]) {
    const previous = new Map(
      snapshot.kind === "ready"
        ? snapshot.entries.map((entry) => [entry.provider, entry])
        : [],
    );
    snapshot = {
      kind: "ready",
      entries: entries.map((entry) => {
        const old = previous.get(entry.provider);
        return old && JSON.stringify(old) === JSON.stringify(entry)
          ? old
          : entry;
      }),
    };
    emitter.notify();
  }
  const stop = port.observe((entries) => {
    version++;
    apply(entries);
  });
  function load(): Promise<void> {
    if (inflight) return inflight;
    const started = version;
    const run = port.snapshot().then(
      (entries) => {
        if (closed || version !== started) return;
        apply(entries);
      },
      (error: unknown) => {
        if (closed || snapshot.kind === "ready") return;
        snapshot = {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        emitter.notify();
      },
    );
    inflight = run.finally(() => {
      inflight = null;
    });
    return inflight;
  }
  void load();
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    async entries() {
      if (snapshot.kind !== "ready") await load();
      const current: ProviderCatalogSnapshot = snapshot;
      if (current.kind === "ready") return current.entries;
      throw new Error(
        current.kind === "error" ? current.message : "Providers are loading",
      );
    },
    load,
    refresh: () => port.refresh(),
    async close() {
      closed = true;
      emitter.clear();
      await stop();
    },
  };
}
