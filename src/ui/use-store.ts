import { useSyncExternalStore } from "react";

export interface ExternalStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

export function useStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
