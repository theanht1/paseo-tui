import type { PaseoAgent } from "@getpaseo/client";
import { createEmitter } from "./emitter.js";
import type { TimelineStore } from "./timeline-store.js";

export interface TimelineRegistry {
  acquire(agent: PaseoAgent): {
    readonly store: TimelineStore;
    release(): void;
  };
  reopen(agentId: string): void;
  subscribe(listener: () => void): () => void;
  close(): void;
}
export function createTimelineRegistry(
  open: (agent: PaseoAgent) => TimelineStore,
): TimelineRegistry {
  const entries = new Map<
    string,
    { agent: PaseoAgent; store: TimelineStore; refs: number }
  >();
  const emitter = createEmitter();
  return {
    acquire(agent) {
      let entry = entries.get(agent.id);
      if (!entry) {
        const store = open(agent);
        entry = { agent, store, refs: 0 };
        entries.set(agent.id, entry);
        void store.open();
      }
      entry.refs++;
      const held = entry;
      let released = false;
      return {
        get store() {
          return held.store;
        },
        release() {
          if (released || entries.get(agent.id) !== held) return;
          released = true;
          held.refs--;
          if (held.refs === 0) {
            held.store.close();
            entries.delete(agent.id);
          }
        },
      };
    },
    reopen(id) {
      const entry = entries.get(id);
      if (!entry) return;
      const status = entry.store.getSnapshot().status;
      if (status !== "error" && status !== "closed") return;
      entry.store.close();
      entry.store = open(entry.agent);
      void entry.store.open();
      emitter.notify();
    },
    subscribe: emitter.subscribe,
    close() {
      for (const entry of entries.values()) entry.store.close();
      entries.clear();
      emitter.clear();
    },
  };
}
