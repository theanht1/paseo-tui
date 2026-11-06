import type {
  PaseoAgent,
  PaseoProject,
  PaseoTerminal,
  PaseoWorkspace,
} from "@getpaseo/client";
import type { ProviderSubagent } from "../../connection/ports.js";
import { agentName } from "../agent/agent-display.js";
export type WorkspaceRow = Pick<
  PaseoWorkspace,
  | "id"
  | "projectId"
  | "name"
  | "title"
  | "workspaceDirectory"
  | "projectRootPath"
  | "diffStat"
  | "gitRuntime"
  | "githubRuntime"
  | "setupStatus"
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
export function projectTree(
  projects: readonly PaseoProject[],
  workspaces: readonly WorkspaceRow[],
): ProjectNode[] {
  return projects.map((project) => ({
    project,
    workspaces: workspaces.filter(
      (workspace) => workspace.projectId === project.projectId,
    ),
  }));
}
export function workspaceTabs(
  workspaceId: string | null,
  agents: readonly PaseoAgent[],
  terminals: readonly PaseoTerminal[],
  subagents: readonly SubagentTab[] = [],
  archived: readonly PaseoAgent[] = [],
): WorkspaceTab[] {
  const live = agents.filter(
    (agent) => agent.workspaceId === workspaceId && agent.archivedAt == null,
  );
  const liveIds = new Set(live.map((agent) => agent.id));
  const extra = archived.filter(
    (agent) => agent.workspaceId === workspaceId && !liveIds.has(agent.id),
  );
  return [
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
