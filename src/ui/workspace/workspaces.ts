import type {
  PaseoAgent,
  PaseoProject,
  PaseoTerminal,
  PaseoWorkspace,
} from "@getpaseo/client";
import type { ProviderSubagent } from "../../connection/ports.js";
import { agentName } from "../agent/agent-display.js";
import {
  arrange,
  moveKey,
  NO_ORDER,
  type OrderChange,
  type StoredOrder,
} from "./ordering.js";
export type WorkspaceRow = Pick<
  PaseoWorkspace,
  | "id"
  | "activityAt"
  | "statusEnteredAt"
  | "lastUserMessageAt"
  | "projectId"
  | "name"
  | "title"
  | "workspaceDirectory"
  | "projectRootPath"
  | "diffStat"
  | "gitRuntime"
  | "githubRuntime"
  | "setupStatus"
  | "labels"
  | "pinnedAt"
>;
export interface ProjectNode {
  project: PaseoProject;
  workspaces: readonly WorkspaceRow[];
}
/** A read-only provider subagent chat opened as its own tab (client-side only). */
export interface SubagentTab {
  kind: "subagent";
  key: string;
  workspaceId: string;
  descriptor: ProviderSubagent;
}
export type WorkspaceTab =
  | { kind: "agent"; key: string; agent: PaseoAgent }
  | { kind: "terminal"; key: string; terminal: PaseoTerminal }
  | SubagentTab;
export function subagentTab(
  workspaceId: string,
  descriptor: ProviderSubagent,
): SubagentTab {
  return {
    kind: "subagent",
    key: `subagent:${descriptor.parentAgentId}:${descriptor.id}`,
    workspaceId,
    descriptor,
  };
}
export function subagentTabName(descriptor: ProviderSubagent): string {
  return (
    descriptor.title?.trim() || descriptor.description?.trim() || "Subagent"
  );
}
export function tabName(tab: WorkspaceTab): string {
  return tab.kind === "agent"
    ? agentName(tab.agent)
    : tab.kind === "terminal"
      ? tab.terminal.name
      : subagentTabName(tab.descriptor);
}
export function tabWorkspaceId(tab: WorkspaceTab): string | null {
  return tab.kind === "agent"
    ? (tab.agent.workspaceId ?? null)
    : tab.kind === "terminal"
      ? tab.terminal.workspaceId
      : tab.workspaceId;
}
/** Projects (new ones last) and their workspaces (new ones first) in the stored order. */
export function projectTree(
  projects: readonly PaseoProject[],
  workspaces: readonly WorkspaceRow[],
  order: StoredOrder = NO_ORDER,
): ProjectNode[] {
  return arrange(
    projects,
    order.projects,
    (project) => project.projectId,
    "append",
  ).map((project) => ({
    project,
    workspaces: arrange(
      workspaces.filter(
        (workspace) => workspace.projectId === project.projectId,
      ),
      order.workspaces.get(project.projectId) ?? [],
      (workspace) => workspace.id,
      "prepend",
    ),
  }));
}
export function workspaceTabs(
  workspaceId: string | null,
  agents: readonly PaseoAgent[],
  terminals: readonly PaseoTerminal[],
  subagents: readonly SubagentTab[] = [],
  archived: readonly PaseoAgent[] = [],
  order: StoredOrder = NO_ORDER,
): WorkspaceTab[] {
  const live = agents.filter(
    (agent) => agent.workspaceId === workspaceId && agent.archivedAt == null,
  );
  const liveIds = new Set(live.map((agent) => agent.id));
  const extra = archived.filter(
    (agent) => agent.workspaceId === workspaceId && !liveIds.has(agent.id),
  );
  const natural = [
    ...[...live, ...extra]
      .toSorted(
        (x, y) =>
          Date.parse(x.createdAt) - Date.parse(y.createdAt) ||
          x.id.localeCompare(y.id),
      )
      .map(
        (agent): WorkspaceTab => ({
          kind: "agent",
          key: `agent:${agent.id}`,
          agent,
        }),
      ),
    ...terminals
      .filter((terminal) => terminal.workspaceId === workspaceId)
      .map(
        (terminal): WorkspaceTab => ({
          kind: "terminal",
          key: `terminal:${terminal.id}`,
          terminal,
        }),
      ),
    ...subagents.filter((tab) => tab.workspaceId === workspaceId),
  ];
  return arrange(
    natural,
    workspaceId === null ? [] : (order.tabs.get(workspaceId) ?? []),
    (tab) => tab.key,
    "append",
  );
}
function projectOf(projects: readonly ProjectNode[], workspaceId: string) {
  return projects.find((node) =>
    node.workspaces.some((workspace) => workspace.id === workspaceId),
  );
}
/** Moves a workspace by `delta` within its project. */
export function workspaceMove(
  projects: readonly ProjectNode[],
  order: StoredOrder,
  workspaceId: string,
  delta: number,
): OrderChange | null {
  const node = projectOf(projects, workspaceId);
  if (!node) return null;
  const projectKey = node.project.projectId;
  const keys = moveKey(
    node.workspaces.map((workspace) => workspace.id),
    workspaceId,
    delta,
    order.workspaces.get(projectKey) ?? [],
  );
  return keys && { kind: "workspaces", projectKey, keys };
}
/** Moves the project holding `workspaceId` by `delta`. */
export function projectMove(
  projects: readonly ProjectNode[],
  order: StoredOrder,
  workspaceId: string,
  delta: number,
): OrderChange | null {
  const node = projectOf(projects, workspaceId);
  if (!node) return null;
  const keys = moveKey(
    projects.map(({ project }) => project.projectId),
    node.project.projectId,
    delta,
    order.projects,
  );
  return keys && { kind: "projects", keys };
}
/** Moves a workspace's tab by `delta` among its tabs. */
export function tabMove(
  tabs: readonly WorkspaceTab[],
  order: StoredOrder,
  workspaceId: string,
  tabKey: string,
  delta: number,
): OrderChange | null {
  const keys = moveKey(
    tabs.map((tab) => tab.key),
    tabKey,
    delta,
    order.tabs.get(workspaceId) ?? [],
  );
  return keys && { kind: "tabs", workspaceKey: workspaceId, keys };
}
export function cycleTab(
  tabs: readonly WorkspaceTab[],
  current: string | null,
  delta: number,
): WorkspaceTab | null {
  if (!tabs.length) return null;
  const index = tabs.findIndex((tab) => tab.key === current);
  return tabs[(Math.max(index, 0) + delta + tabs.length) % tabs.length] ?? null;
}
