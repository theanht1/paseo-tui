import type {
  PaseoAgent,
  PaseoAgentCreateOptions,
  PaseoApi,
  PaseoProject,
  PaseoTerminal,
  PaseoWorkspaceAgentCreateOptions,
  PaseoWorkspaceCreateOptions,
} from "@getpaseo/client";
import type { ProjectPort } from "../../connection/ports.js";
import type { CreateAgentInput } from "../../state/ports.js";
import type { EditorTerminal } from "../file-links/editor-terminal.js";
import { defaultBaseBranch } from "./base-branch.js";
import type { WorkspaceRow, WorkspaceTab } from "./workspaces.js";
export interface ManagementCapabilities {
  create: boolean;
  thinking?: boolean;
  workspace: boolean;
  terminal: boolean;
}
export type WorkspacePlacement =
  | { kind: "local" }
  | { kind: "worktree"; baseBranch: string; branchName: string | null };
export interface BaseBranches {
  branches: readonly string[];
  defaultBranch: string | null;
}
export interface CreatedWorkspace {
  workspace: WorkspaceRow;
  agent: PaseoAgent | null;
}
export interface ManagementApi {
  createWorkspace(
    options: PaseoWorkspaceCreateOptions,
  ): Promise<CreatedWorkspace>;
  createAgent(
    workspaceId: string,
    options: PaseoWorkspaceAgentCreateOptions,
  ): Promise<PaseoAgent>;
  /** `options` names the terminal and runs `command` instead of the shell. */
  createTerminal(
    workspaceId: string,
    options?: EditorTerminal,
  ): Promise<PaseoTerminal>;
  renameWorkspace(id: string, title: string): Promise<void>;
  renameAgent(id: string, title: string): Promise<void>;
  renameTerminal(id: string, title: string): Promise<void>;
  archiveAgent(id: string): Promise<void>;
  archiveWorkspace(id: string): Promise<void>;
  killTerminal(id: string): Promise<void>;
  /** Branch names of the repository at `cwd` and the daemon-reported base ref. */
  branches(
    cwd: string,
  ): Promise<{ branches: string[]; baseRef: string | null }>;
  projects: ProjectPort;
}
function updateRequired(feature: string) {
  return Error(`Update the Paseo daemon to use ${feature}.`);
}
function requireCapability(supported: boolean, feature: string) {
  if (!supported) throw updateRequired(feature);
}
function agentOptions(input: CreateAgentInput): PaseoAgentCreateOptions {
  return {
    cwd: input.cwd,
    config: {
      provider: `${input.provider}/${input.model}`,
      ...(input.thinkingOptionId !== undefined
        ? { thinkingOptionId: input.thinkingOptionId }
        : {}),
      ...(input.modeId ? { modeId: input.modeId } : {}),
    },
    ...(input.title ? { title: input.title } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.attachments?.length
      ? { attachments: [...input.attachments] }
      : {}),
  };
}
function trimmedTitle(title: string) {
  const value = title.trim();
  if (!value) throw Error("Name can't be empty");
  return value;
}
export function createWorkspaceActions(
  api: ManagementApi,
  capabilities: ManagementCapabilities,
) {
  function checkThinking(input: CreateAgentInput) {
    if (input.thinkingOptionId !== undefined)
      requireCapability(
        capabilities.thinking === true,
        "thinking configuration (agentThinkingUpdate)",
      );
  }
  return {
    async baseBranches(project: PaseoProject): Promise<BaseBranches> {
      const { branches, baseRef } = await api.branches(project.projectRootPath);
      const defaultBranch = defaultBaseBranch(branches, baseRef);
      return {
        branches: defaultBranch
          ? [
              defaultBranch,
              ...branches.filter((name) => name !== defaultBranch),
            ]
          : branches,
        defaultBranch,
      };
    },
    async createWorkspace(
      project: PaseoProject,
      input: CreateAgentInput,
      placement: WorkspacePlacement,
    ) {
      requireCapability(
        capabilities.create,
        "workspace creation (creationLifecycle)",
      );
      requireCapability(
        capabilities.workspace,
        "workspaces (workspaceMultiplicity)",
      );
      checkThinking(input);
      return api.createWorkspace({
        source:
          placement.kind === "worktree"
            ? {
                kind: "worktree",
                projectId: project.projectId,
                cwd: project.projectRootPath,
                action: "branch-off",
                baseBranch: placement.baseBranch,
                ...(placement.branchName
                  ? { branchName: placement.branchName }
                  : {}),
              }
            : {
                kind: "directory",
                path: project.projectRootPath,
                projectId: project.projectId,
              },
        agent: agentOptions(input),
        ...(input.title ? { title: input.title } : {}),
      });
    },
    async createAgent(workspace: WorkspaceRow, input: CreateAgentInput) {
      requireCapability(
        capabilities.create,
        "agent creation (creationLifecycle)",
      );
      checkThinking(input);
      const { cwd: _, ...options } = agentOptions(input);
      return api.createAgent(workspace.id, options);
    },
    async createTerminal(workspace: WorkspaceRow) {
      requireCapability(
        capabilities.terminal,
        "workspace terminals (workspaceTerminals)",
      );
      return api.createTerminal(workspace.id);
    },
    async openFile(workspace: WorkspaceRow, editor: EditorTerminal) {
      requireCapability(
        capabilities.terminal,
        "editor terminals (workspaceTerminals)",
      );
      return api.createTerminal(workspace.id, editor);
    },
    async renameWorkspace(workspace: WorkspaceRow, title: string) {
      requireCapability(
        capabilities.workspace,
        "workspace titles (workspaceMultiplicity)",
      );
      await api.renameWorkspace(workspace.id, trimmedTitle(title));
    },
    async renameTab(tab: WorkspaceTab, title: string) {
      const name = trimmedTitle(title);
      if (tab.kind === "agent") await api.renameAgent(tab.agent.id, name);
      else if (tab.kind === "subagent")
        throw Error("Subagent tabs are named after their subagent");
      else {
        requireCapability(
          capabilities.terminal,
          "terminal renaming (workspaceTerminals)",
        );
        await api.renameTerminal(tab.terminal.id, name);
      }
    },
    async closeTab(tab: WorkspaceTab) {
      if (tab.kind === "agent") await api.archiveAgent(tab.agent.id);
      else if (tab.kind === "subagent") return;
      else {
        requireCapability(
          capabilities.terminal,
          "terminal closing (workspaceTerminals)",
        );
        await api.killTerminal(tab.terminal.id);
      }
    },
    directories: (query: string) => api.projects.directories(query),
    async addProject(cwd: string) {
      const add = api.projects.add;
      if (!add) throw updateRequired("adding projects (projectAdd)");
      const path = cwd.trim();
      if (!path) throw Error("Choose a directory");
      return add(path);
    },
    /**
     * Archives each of the project's workspaces first, as Archive workspace does: the
     * daemon deletes a workspace's Paseo worktree on that archive, but removing the
     * project alone leaves worktrees on disk. The main checkout is never deleted.
     */
    async removeProject(
      project: PaseoProject,
      workspaces: readonly WorkspaceRow[],
    ) {
      const remove = api.projects.remove;
      if (!remove) throw updateRequired("removing projects (projectRemove)");
      requireCapability(
        capabilities.workspace,
        "workspace archiving (workspaceMultiplicity)",
      );
      for (const workspace of workspaces)
        await api.archiveWorkspace(workspace.id);
      await remove(project.projectId);
    },
    async archiveWorkspace(workspace: WorkspaceRow) {
      requireCapability(
        capabilities.workspace,
        "workspace archiving (workspaceMultiplicity)",
      );
      await api.archiveWorkspace(workspace.id);
    },
  };
}
export type WorkspaceActions = ReturnType<typeof createWorkspaceActions>;
export function managementApi(
  api: Pick<PaseoApi, "workspaces" | "terminals" | "agents">,
  daemon: Pick<
    ManagementApi,
    "renameAgent" | "renameTerminal" | "branches" | "projects"
  >,
): ManagementApi {
  return {
    async createWorkspace(options) {
      let agent: PaseoAgent | null = null;
      const handle = await api.workspaces.create({
        ...options,
        onEvent(snapshot) {
          if (snapshot.agent) agent = snapshot.agent;
        },
      });
      const workspace = handle.current();
      if (!workspace) throw Error("Workspace created without a snapshot");
      return { workspace, agent };
    },
    async createAgent(id, options) {
      const handle = await api.workspaces.ref(id).agents.create(options);
      const agent = handle.current();
      if (!agent) throw Error("Agent created without a snapshot");
      return agent;
    },
    async createTerminal(workspaceId, options) {
      const handle = await api.terminals.create({ workspaceId, ...options });
      const terminal = handle.current();
      if (!terminal) throw Error("Terminal created without a snapshot");
      return terminal;
    },
    async renameWorkspace(id, title) {
      await api.workspaces.ref(id).setTitle(title);
    },
    async archiveAgent(id) {
      await api.agents.ref(id).archive();
    },
    async archiveWorkspace(id) {
      await api.workspaces.ref(id).archive();
    },
    async killTerminal(id) {
      await api.terminals.ref(id).kill();
    },
    ...daemon,
  };
}
