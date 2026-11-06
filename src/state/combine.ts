import { createEmitter } from "./emitter.js";

interface Store<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}
/**
 * One store over a changing list of sources (one per connected host): its snapshot
 * merges every source's store, stays the same object while nothing changed, and
 * follows sources as they are added or removed.
 */
export function combineStores<S, T, R>(options: {
  sources: Store<readonly S[]>;
  store(source: S): Store<T>;
  merge(values: readonly { source: S; value: T }[]): R;
}): Store<R> {
  const emitter = createEmitter();
  let cached: {
    sources: readonly S[];
    values: readonly T[];
    result: R;
  } | null = null;
  let watched = new Map<Store<T>, () => void>();
  let stopSources: (() => void) | null = null;
  let listeners = 0;
  function follow() {
    const next = new Map<Store<T>, () => void>();
    for (const source of options.sources.getSnapshot()) {
      const store = options.store(source);
      next.set(
        store,
        watched.get(store) ?? store.subscribe(() => emitter.notify()),
      );
    }
    for (const [store, stop] of watched) if (!next.has(store)) stop();
    watched = next;
  }
  return {
    subscribe(listener) {
      const stop = emitter.subscribe(listener);
      listeners++;
      if (!stopSources) {
        stopSources = options.sources.subscribe(() => {
          follow();
          emitter.notify();
        });
        follow();
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        stop();
        listeners--;
        if (listeners > 0) return;
        stopSources?.();
        stopSources = null;
        for (const unsubscribe of watched.values()) unsubscribe();
        watched = new Map();
      };
    },
    getSnapshot() {
      const sources = options.sources.getSnapshot();
      const values = sources.map((source) =>
        options.store(source).getSnapshot(),
      );
      if (
        cached &&
        cached.sources === sources &&
        cached.values.every((value, index) => value === values[index])
      )
        return cached.result;
      const result = options.merge(
        sources.map((source, index) => ({
          source,
          value: values[index] as T,
        })),
      );
      cached = { sources, values, result };
      return result;
    },
  };
}
