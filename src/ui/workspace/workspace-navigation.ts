import type { PaseoAgent, PaseoTerminal } from "@getpaseo/client";
import { createEmitter } from "../../state/emitter.js";
import {
  assign,
  clearAgent,
  type Layout,
  panes,
} from "../layout/split-tree.js";
import {
  type SubagentTab,
  tabWorkspaceId,
  type WorkspaceRow,
  type WorkspaceTab,
  workspaceTabs,
} from "./workspaces.js";

interface NavigationSnapshot {
  cursorId: string | null;
  workspaceId: string | null;
  tab: WorkspaceTab | null;
}
/** `tabs`: the tab key to reopen per workspace, e.g. remembered from the last run. */
export function createWorkspaceNavigation(
  tabs: ReadonlyMap<string, string> = new Map(),
) {
  const emitter = createEmitter();
  const remembered = new Map(tabs);
  let previousIds: readonly string[] = [];
  const removedIds = new Set<string>();
  /** Tab key to reselect when the keyed tab disappears (an exited editor terminal). */
  const returns = new Map<string, string>();
  let snapshot: NavigationSnapshot = {
    cursorId: null,
    workspaceId: null,
    tab: null,
  };
  function selectTab(tab: WorkspaceTab, returnTo?: string) {
    // Refocusing a tab from itself keeps the tab it first returns to.
    if (returnTo && returnTo !== tab.key) returns.set(tab.key, returnTo);
    const workspaceId = tabWorkspaceId(tab);
    if (workspaceId) remembered.set(workspaceId, tab.key);
    snapshot = { cursorId: workspaceId, workspaceId, tab };
    emitter.notify();
  }
  function selectWorkspace(
    workspace: WorkspaceRow,
    agents: readonly PaseoAgent[],
    terminals: readonly PaseoTerminal[],
    subagents: readonly SubagentTab[] = [],
  ): WorkspaceTab | null {
    const tabs = workspaceTabs(workspace.id, agents, terminals, subagents);
    const tab =
      tabs.find((tab) => tab.key === remembered.get(workspace.id)) ??
      tabs[0] ??
      null;
    snapshot = { cursorId: workspace.id, workspaceId: workspace.id, tab };
    emitter.notify();
    return tab;
  }
  function cursor(id: string) {
    snapshot = { ...snapshot, cursorId: id };
    emitter.notify();
  }
  function moveCursor(workspaces: readonly WorkspaceRow[], delta: number) {
    const index = workspaces.findIndex(
      (workspace) => workspace.id === snapshot.cursorId,
    );
    const next =
      workspaces[
        Math.max(0, Math.min(workspaces.length - 1, Math.max(0, index) + delta))
      ];
    if (next) cursor(next.id);
  }
  function isWorkspaceRemoved(id: string): boolean {
    return removedIds.has(id);
  }
  function reconcile(
    workspaces: readonly WorkspaceRow[],
    agents: readonly PaseoAgent[],
    terminals: readonly PaseoTerminal[],
    subagents: readonly SubagentTab[] = [],
  ): NavigationSnapshot {
    const ids = new Set(workspaces.map((workspace) => workspace.id));
    for (const id of previousIds) {
      if (!ids.has(id)) removedIds.add(id);
    }
    for (const id of ids) removedIds.delete(id);
    if (
      snapshot.workspaceId &&
      !ids.has(snapshot.workspaceId) &&
      !isWorkspaceRemoved(snapshot.workspaceId)
    ) {
      previousIds = [...ids];
      return snapshot;
    }
    function surviving(id: string | null): string | null {
      if (id === null) return null;
      if (workspaces.some((workspace) => workspace.id === id)) return id;
      const index = Math.max(0, previousIds.indexOf(id));
      return workspaces[Math.min(index, workspaces.length - 1)]?.id ?? null;
    }
    const workspaceId = surviving(snapshot.workspaceId);
    const cursorId = surviving(snapshot.cursorId);
    const tabs = workspaceTabs(workspaceId, agents, terminals, subagents);
    const currentKey = snapshot.tab?.key;
    const returnKey =
      currentKey && !tabs.some((tab) => tab.key === currentKey)
        ? returns.get(currentKey)
        : undefined;
    if (currentKey && returnKey) returns.delete(currentKey);
    const key =
      workspaceId === snapshot.workspaceId
        ? (returnKey ?? currentKey)
        : workspaceId
          ? remembered.get(workspaceId)
          : undefined;
    const tab =
      workspaceId === null
        ? null
        : (tabs.find((tab) => tab.key === key) ?? tabs[0] ?? null);
    if (returnKey && tab && workspaceId) remembered.set(workspaceId, tab.key);
    previousIds = workspaces.map((workspace) => workspace.id);
    for (const id of remembered.keys()) {
      if (isWorkspaceRemoved(id)) remembered.delete(id);
    }
    const previousTab = snapshot.tab;
    const sameTab =
      previousTab?.kind === "agent" && tab?.kind === "agent"
        ? previousTab.agent === tab.agent
        : previousTab?.kind === "terminal" && tab?.kind === "terminal"
          ? previousTab.terminal === tab.terminal
          : previousTab?.kind === "subagent" && tab?.kind === "subagent"
            ? previousTab.descriptor === tab.descriptor
            : previousTab === tab;
    if (
      workspaceId !== snapshot.workspaceId ||
      cursorId !== snapshot.cursorId ||
      !sameTab
    ) {
      snapshot = { workspaceId, cursorId, tab };
      emitter.notify();
    }
    return snapshot;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    selectWorkspace,
    selectTab,
    cursor,
    moveCursor,
    reconcile,
    isWorkspaceRemoved,
  };
}

interface WorkspaceLayoutContext {
  agents: readonly PaseoAgent[];
  tab: WorkspaceTab | null;
  pendingAgentIds: ReadonlySet<string>;
  isWorkspaceRemoved(id: string): boolean;
}
export function reconcileWorkspaceLayout(
  previous: Layout,
  context: WorkspaceLayoutContext,
): Layout {
  let result = previous;
  for (const pane of panes(previous)) {
    const agent = context.agents.find((agent) => agent.id === pane.agentId);
    if (
      pane.agentId &&
      (!agent ||
        (agent.workspaceId != null &&
          context.isWorkspaceRemoved(agent.workspaceId))) &&
      !context.pendingAgentIds.has(pane.agentId)
    )
      result = clearAgent(result, pane.agentId);
  }
  const tab = context.tab;
  if (
    tab?.kind === "agent" &&
    context.agents.some((agent) => agent.id === tab.agent.id)
  ) {
    const focused = panes(result).find((pane) => pane.id === result.focusedId);
    if (
      focused?.agentId !== tab.agent.id &&
      (!focused?.agentId || !context.pendingAgentIds.has(focused.agentId))
    )
      result = assign(result, tab.agent.id);
  }
  return result;
}
