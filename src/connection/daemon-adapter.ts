import type { createHostClient } from "@getpaseo/client/node";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type {
  CompletionPort,
  DirectoryPort,
  DraftCommandConfig,
  ProviderSubagentPort,
  ProviderSubagentTimelinePage,
  ProviderSubagentUpdate,
  TerminalStreamPort,
  TimelineCursor,
} from "./ports.js";

type Daemon = Pick<
  ReturnType<typeof createHostClient>,
  | "cancelAgent"
  | "setAgentMode"
  | "setAgentModel"
  | "updateAgent"
  | "clearAgentAttention"
>;
export interface DaemonAdapter {
  cancelAgent(agentId: string): Promise<void>;
  setAgentMode(agentId: string, modeId: string): Promise<string | null>;
  setAgentModel(agentId: string, modelId: string): Promise<void>;
  renameAgent(agentId: string, name: string): Promise<void>;
  clearAgentAttention(agentId: string): Promise<void>;
}
export function createDaemonAdapter(daemon: Daemon): DaemonAdapter {
  return {
    cancelAgent: (id) => daemon.cancelAgent(id),
    async setAgentMode(id, modeId) {
      const notice = await daemon.setAgentMode(id, modeId);
      if (notice?.type === "error") throw new Error(notice.message);
      return notice?.message ?? null;
    },
    setAgentModel: (id, modelId) => daemon.setAgentModel(id, modelId),
    async renameAgent(id, name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Name can't be empty");
      await daemon.updateAgent(id, { name: trimmed });
    },
    clearAgentAttention: (id) => daemon.clearAgentAttention(id),
  };
}

export function requireWorkspaceCapabilities(
  daemon: Pick<ReturnType<typeof createHostClient>, "getLastServerInfoMessage">,
): void {
  const features = daemon.getLastServerInfoMessage()?.features;
  if (
    features?.workspaceMultiplicity !== true ||
    features.workspaceTerminals !== true ||
    features.projectList !== true
  )
    throw new Error(
      "Update the Paseo daemon to use projects, workspaces and terminal tabs (projectList, workspaceMultiplicity and workspaceTerminals required).",
    );
}

export function createManagementAdapter(
  daemon: Pick<
    ReturnType<typeof createHostClient>,
    "getLastServerInfoMessage" | "renameTerminal"
  >,
) {
  const features = daemon.getLastServerInfoMessage()?.features;
  return {
    capabilities: {
      create: features?.creationLifecycle === true,
      thinking: features?.agentThinkingUpdate === true,
      workspace: features?.workspaceMultiplicity === true,
      terminal: features?.workspaceTerminals === true,
    },
    async renameTerminal(id: string, title: string) {
      if (features?.workspaceTerminals !== true)
        throw Error(
          "Update the Paseo daemon to rename terminals (workspaceTerminals required).",
        );
      const result = await daemon.renameTerminal({ terminalId: id, title });
      if (!result.success)
        throw Error(result.error ?? "Terminal rename failed");
    },
  };
}

export function createTerminalStreamAdapter(
  daemon: Pick<
    ReturnType<typeof createHostClient>,
    "observeTerminal" | "sendTerminalInput"
  >,
): TerminalStreamPort {
  return {
    observe(id, receive, onError) {
      const subscription = daemon.observeTerminal(id, receive);
      const unsubscribe = subscription.subscribe({
        snapshot() {},
        update(message) {
          if (
            message.type === "terminal_stream_exit" &&
            message.payload.error
          ) {
            onError(message.payload.error);
          }
        },
        error: onError,
      });
      return {
        ready: subscription.ready.then((result) => {
          if (result.error) throw Error(result.error);
        }),
        async close() {
          unsubscribe();
          await subscription.release();
        },
      };
    },
    write(id, data) {
      daemon.sendTerminalInput(id, { type: "input", data });
    },
    resize(id, cols, rows) {
      daemon.sendTerminalInput(id, {
        type: "resize",
        cols,
        rows,
        intent: "claim",
      });
    },
  };
}

/** Any id the daemon does not know; with `draftConfig` it lists the provider's draft commands. */
export const DRAFT_COMMANDS_AGENT_ID = "paseo-tui-draft";
interface CompletionDaemon {
  listCommands(options: {
    agentId: string;
    draftConfig?: DraftCommandConfig;
  }): Promise<{
    error: string | null;
    commands: {
      name: string;
      description: string;
      argumentHint: string;
      kind?: "command" | "skill";
    }[];
  }>;
  getDirectorySuggestions(options: {
    query: string;
    cwd: string;
    includeFiles: boolean;
    includeDirectories: boolean;
    matchMode: "fuzzy";
    limit: number;
  }): Promise<{
    error: string | null;
    entries: { path: string; kind: "file" | "directory" }[];
  }>;
}
/** Both RPCs are baseline daemon requests (no server_info feature flag gates them). */
export function createCompletionAdapter(
  daemon: CompletionDaemon,
): CompletionPort {
  return {
    async commands(source) {
      const result = await daemon.listCommands(
        source.kind === "agent"
          ? { agentId: source.agentId }
          : { agentId: DRAFT_COMMANDS_AGENT_ID, draftConfig: source.config },
      );
      if (result.error) throw Error(result.error);
      return result.commands.map((command) => ({
        name: command.name,
        description: command.description,
        argumentHint: command.argumentHint,
        kind: command.kind ?? "command",
      }));
    },
    async files(cwd, query) {
      const result = await daemon.getDirectorySuggestions({
        query,
        cwd,
        includeFiles: true,
        includeDirectories: true,
        matchMode: "fuzzy",
        limit: 50,
      });
      if (result.error) throw Error(result.error);
      return result.entries.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      }));
    },
  };
}

interface GitDaemon {
  getBranchSuggestions(options: {
    cwd: string;
    limit?: number;
  }): Promise<{ branches: string[]; error: string | null }>;
  getCheckoutStatus(cwd: string): Promise<{ baseRef: string | null }>;
}
/** Baseline daemon requests (no server_info feature flag gates them). */
export function createGitAdapter(daemon: GitDaemon) {
  return {
    async branches(cwd: string) {
      const result = await daemon.getBranchSuggestions({ cwd, limit: 200 });
      if (result.error) throw Error(result.error);
      const status = await daemon.getCheckoutStatus(cwd);
      return { branches: result.branches, baseRef: status.baseRef };
    },
  };
}

interface SubagentDaemon {
  getLastServerInfoMessage(): {
    features?: {
      providerSubagents?: boolean;
      projectedSubagentTimeline?: boolean;
    };
  } | null;
  listProviderSubagents(parentAgentId: string): Promise<{
    error: string | null;
    subagents: ProviderSubagentDescriptorPayload[];
  }>;
  fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options: {
      direction: "tail" | "after";
      limit: number;
      cursor?: TimelineCursor;
    },
  ): Promise<ProviderSubagentTimelinePage>;
  observeEvents(events: ["agent.provider_subagents.update"]): {
    subscribe(observer: {
      snapshot(): void;
      update(message: { type: string; payload?: unknown }): void;
    }): () => void;
    release(): Promise<void>;
  };
}
function isSubagentUpdate(message: {
  type: string;
  payload?: unknown;
}): message is {
  type: "agent.provider_subagents.update";
  payload: ProviderSubagentUpdate;
} {
  return message.type === "agent.provider_subagents.update";
}
/** Provider subagents need `providerSubagents`; their chats also need `projectedSubagentTimeline`. */
export function createSubagentAdapter(
  daemon: SubagentDaemon,
): ProviderSubagentPort | null {
  const features = daemon.getLastServerInfoMessage()?.features;
  if (features?.providerSubagents !== true) return null;
  const timelines = features.projectedSubagentTimeline === true;
  return {
    async list(parentAgentId) {
      const result = await daemon.listProviderSubagents(parentAgentId);
      if (result.error) throw Error(result.error);
      return result.subagents;
    },
    observe(handler) {
      const subscription = daemon.observeEvents([
        "agent.provider_subagents.update",
      ]);
      const unsubscribe = subscription.subscribe({
        snapshot() {},
        update(message) {
          if (isSubagentUpdate(message)) handler(message.payload);
        },
      });
      return () => {
        unsubscribe();
        void subscription.release().catch(() => {});
      };
    },
    async timeline(parentAgentId, subagentId, options) {
      if (!timelines)
        throw Error(
          "Update the Paseo daemon to view subagent chats (projectedSubagentTimeline required).",
        );
      const result = await daemon.fetchProviderSubagentTimeline(
        parentAgentId,
        subagentId,
        options,
      );
      if (result.error) throw Error(result.error);
      return result;
    },
  };
}

/**
 * Baseline file-explorer request (no feature flag). Rooting the listing at the directory
 * itself keeps it inside the daemon's workspace scope check, and the daemon expands `~`.
 */
export function createDirectoryAdapter(daemon: {
  listDirectory(
    cwd: string,
    path: string,
  ): Promise<{
    entries: readonly { name: string; kind: "file" | "directory" }[];
  }>;
}): DirectoryPort {
  return {
    async list(directory) {
      const listing = await daemon.listDirectory(directory, ".");
      return listing.entries.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
      }));
    },
  };
}
