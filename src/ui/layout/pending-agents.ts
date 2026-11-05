import type { PaseoAgent } from "@getpaseo/client";
import { clearAgent, type Layout, type PaneNode, panes } from "./split-tree.js";

const PENDING_MS = 10_000;

/** Agents just created here: their panes wait up to ten seconds for the agent list to catch up. */
export function createPendingAgents() {
  const created = new Map<string, number>();
  function fresh(id: string, now: number) {
    return now - (created.get(id) ?? -Infinity) < PENDING_MS;
  }
  return {
    add(id: string, now: number) {
      created.set(id, now);
    },
    ids: () => created.keys(),
    /** Forgets agents that arrived, expired, or no pane shows. */
    prune(
      shown: readonly PaneNode[],
      agents: readonly PaseoAgent[],
      now: number,
    ) {
      for (const id of created.keys())
        if (
          !shown.some((pane) => pane.agentId === id) ||
          agents.some((agent) => agent.id === id) ||
          !fresh(id, now)
        )
          created.delete(id);
    },
    /** Empties panes whose agent is neither listed nor still pending. */
    clearMissing(
      layout: Layout,
      agents: readonly PaseoAgent[],
      now: number,
    ): Layout {
      let next = layout;
      for (const pane of panes(layout))
        if (
          pane.agentId &&
          !agents.some((agent) => agent.id === pane.agentId) &&
          !fresh(pane.agentId, now)
        )
          next = clearAgent(next, pane.agentId);
      return next;
    },
    /** Milliseconds until the next pending agent expires, or null once none is fresh. */
    untilExpiry(now: number): number | null {
      const waits = [...created.values()]
        .map((at) => at + PENDING_MS - now)
        .filter((wait) => wait > 0);
      return waits.length ? Math.min(...waits) : null;
    },
  };
}
