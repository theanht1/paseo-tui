import type { PaseoAgent } from "@getpaseo/client";
import { createEmitter } from "../../state/emitter.js";
import type { TimelineRegistry } from "../../state/timeline-registry.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import type { PaneNode } from "./split-tree.js";

type Hold = ReturnType<TimelineRegistry["acquire"]>;

/** Holds one registry timeline per pane, keyed `${paneId}:${agentId}`; agents not yet listed wait. */
export function createPaneTimelines(registry: TimelineRegistry) {
  const holds = new Map<string, Hold>();
  const emitter = createEmitter();
  let snapshot: ReadonlyMap<string, TimelineStore> = new Map();
  function publish() {
    const next = new Map(
      [...holds].map(([key, hold]) => [key, hold.store] as const),
    );
    const unchanged =
      next.size === snapshot.size &&
      [...next].every(([key, store]) => snapshot.get(key) === store);
    if (unchanged) return;
    snapshot = next;
    emitter.notify();
  }
  const unsubscribe = registry.subscribe(publish);
  return {
    sync(panes: readonly PaneNode[], agents: readonly PaseoAgent[]) {
      const wanted = new Set<string>();
      for (const pane of panes) {
        if (!pane.agentId) continue;
        const key = `${pane.id}:${pane.agentId}`;
        wanted.add(key);
        if (holds.has(key)) continue;
        const agent = agents.find((candidate) => candidate.id === pane.agentId);
        if (agent) holds.set(key, registry.acquire(agent));
      }
      for (const [key, hold] of holds)
        if (!wanted.has(key)) {
          hold.release();
          holds.delete(key);
        }
      publish();
    },
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    close() {
      unsubscribe();
      for (const hold of holds.values()) hold.release();
      holds.clear();
      publish();
      emitter.clear();
    },
  };
}
export type PaneTimelines = ReturnType<typeof createPaneTimelines>;
