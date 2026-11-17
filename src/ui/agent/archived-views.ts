import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceRecovery } from "../../connection/ports.js";
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
/** An archived view's workspace when it is archived too: being checked, or what restoring it would do. */
export type ArchivedWorkspace =
  | { kind: "checking" }
  | Exclude<WorkspaceRecovery, { kind: "active" }>;
export interface CalloutCopy {
  title: string;
  lines: string[];
  error: boolean;
}
/** The Workspace archived callout; `u` restores the workspace, then unarchives the agent. */
export function workspaceCallout(
  workspace: ArchivedWorkspace,
  state: UnarchiveState,
): CalloutCopy {
  const title = "Workspace archived";
  if (workspace.kind === "checking")
    return {
      title,
      lines: ["Checking whether it can be restored…"],
      error: false,
    };
  if (workspace.kind === "unavailable")
    return { title, lines: [workspace.message], error: true };
  const branch = workspace.branch
    ? [`Its worktree will use branch ${workspace.branch}.`]
    : [];
  const status =
    state.kind === "idle"
      ? "u Restore"
      : state.kind === "pending"
        ? "Restoring…"
        : `! ${state.message}`;
  return {
    title,
    lines: [
      `Restore ${workspace.name} to return to its agents.`,
      ...branch,
      status,
    ],
    error: state.kind === "failed",
  };
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
