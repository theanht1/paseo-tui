import type { PaseoAgent } from "@getpaseo/client";
import type { Action } from "../input/keymap.js";

/** Archived sessions opened from History, by agent id; shown view-only until unarchived. */
export type ArchivedViews = ReadonlyMap<string, PaseoAgent>;
export type UnarchiveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

export type HistoryOpenTarget<W extends { id: string }> =
  | { kind: "live"; agent: PaseoAgent }
  | { kind: "archived"; agent: PaseoAgent; workspace: W | null };
/** A History row opens its listed live agent, else an archived view (in its workspace while that exists). */
export function historyOpenTarget<W extends { id: string }>(
  agent: PaseoAgent,
  live: readonly PaseoAgent[],
  workspaces: readonly W[],
): HistoryOpenTarget<W> {
  const listed = live.find(
    (candidate) => candidate.id === agent.id && candidate.archivedAt == null,
  );
  if (listed) return { kind: "live", agent: listed };
  return {
    kind: "archived",
    agent,
    workspace:
      workspaces.find((workspace) => workspace.id === agent.workspaceId) ??
      null,
  };
}
export function addArchivedView(
  views: ArchivedViews,
  agent: PaseoAgent,
): ArchivedViews {
  return new Map(views).set(agent.id, agent);
}
export function removeArchivedView<V>(
  views: ReadonlyMap<string, V>,
  agentId: string,
): ReadonlyMap<string, V> {
  if (!views.has(agentId)) return views;
  const next = new Map(views);
  next.delete(agentId);
  return next;
}
/** Drops entries (views, unarchive progress) whose agent the live list now holds unarchived; the same map when none. */
export function pruneArchivedViews<V>(
  views: ReadonlyMap<string, V>,
  live: readonly PaseoAgent[],
): ReadonlyMap<string, V> {
  let next = views;
  for (const agent of live)
    if (agent.archivedAt == null) next = removeArchivedView(next, agent.id);
  return next;
}
/** The live agents plus every view they lack: what panes and tabs look agents up in. */
export function withArchivedViews(
  live: readonly PaseoAgent[],
  views: ArchivedViews,
): PaseoAgent[] {
  const ids = new Set(live.map((agent) => agent.id));
  return [
    ...live,
    ...[...views.values()].filter((agent) => !ids.has(agent.id)),
  ];
}
export function archivedCalloutText(state: UnarchiveState): string {
  switch (state.kind) {
    case "idle":
      return "This agent is archived · u Unarchive";
    case "pending":
      return "Unarchiving…";
    case "failed":
      return `! ${state.message}`;
  }
}
/** Pane actions that would change the agent; an archived pane answers them with a notice. */
const MUTATING_ACTIONS: ReadonlySet<Action["type"]> = new Set([
  "insert",
  "prompt.edit",
  "agent.cycleMode",
  "agent.clear",
  "stop",
  "prefix.literal",
]);
export function mutatesAgent(action: Action): boolean {
  return MUTATING_ACTIONS.has(action.type);
}
/** Command Center items that change the agent; Fork stays, since it leaves the source as is. */
const MUTATING_COMMANDS: ReadonlySet<string> = new Set([
  "set-mode",
  "set-model",
  "set-thinking",
  "rewind",
  "clear-session",
  "rename",
]);
/** An archived agent's commands without the ones that would change it; the same list when live. */
export function viewOnlyCommands<T extends { id: string }>(
  agent: PaseoAgent,
  items: T[],
): T[] {
  return agent.archivedAt == null
    ? items
    : items.filter((item) => !MUTATING_COMMANDS.has(item.id));
}
