import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import type { createHostClient } from "@getpaseo/client/node";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type {
  AgentFeaturesPort,
  CompletionPort,
  DirectoryPort,
  DraftCommandConfig,
  HistoryPort,
  ProjectPort,
  ProviderSubagentPort,
  ProviderSubagentTimelinePage,
  ProviderSubagentUpdate,
  SchedulePort,
  TerminalEntry,
  TerminalListPort,
  TerminalStreamPort,
  TimelineCursor,
  UsagePort,
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

export type AgentFeaturesDaemon = Pick<
  ReturnType<typeof createHostClient>,
  | "searchAgentTimeline"
  | "listAgentTimelinePrompts"
  | "rewindAgent"
  | "buildAgentForkContext"
  | "setAgentThinkingOption"
> & {
  getLastServerInfoMessage(): {
    features?: {
      agentHistorySearch?: boolean;
      agentTimelinePromptIndex?: boolean;
      rewind?: boolean;
      agentForkContext?: boolean;
      agentForkContextCursor?: boolean;
      agentThinkingUpdate?: boolean;
    };
  } | null;
};
/** The daemon returns at most 200 locations per page; five pages bound one search. */
const SEARCH_PAGES = 5;
export function createAgentFeaturesAdapter(
  daemon: AgentFeaturesDaemon,
): AgentFeaturesPort {
  const features = daemon.getLastServerInfoMessage()?.features;
  return {
    search:
      features?.agentHistorySearch === true
        ? async (agentId, query) => {
            const seqs: number[] = [];
            let epoch: string | null = null;
            let cursor: number | null = null;
            for (let page = 0; page < SEARCH_PAGES; page++) {
              const result = await daemon.searchAgentTimeline({
                agentId,
                query,
                ...(cursor === null ? {} : { cursor }),
              });
              if (result.error) throw Error(result.error);
              if (epoch !== null && result.epoch !== epoch)
                throw Error("History changed; search again");
              epoch = result.epoch;
              seqs.push(...result.locations.map((location) => location.seq));
              if (result.nextCursor === null)
                return { epoch, seqs, truncated: false };
              cursor = result.nextCursor;
            }
            return { epoch: epoch ?? "", seqs, truncated: true };
          }
        : null,
    prompts:
      features?.agentTimelinePromptIndex === true
        ? async (agentId) => {
            const result = await daemon.listAgentTimelinePrompts(agentId);
            if (result.error) throw Error(result.error);
            return { epoch: result.epoch, prompts: result.prompts };
          }
        : null,
    rewind:
      features?.rewind === true
        ? async (agentId, messageId, mode) => {
            const result = await daemon.rewindAgent(agentId, messageId, mode);
            if (!result.ok) throw Error(result.error ?? "Rewind failed");
          }
        : null,
    forkContext:
      features?.agentForkContext === true &&
      features.agentForkContextCursor === true
        ? async (agentId, boundary) => {
            const result = await daemon.buildAgentForkContext(
              agentId,
              boundary ? { boundaryCursor: boundary } : {},
            );
            if (result.error) throw Error(result.error);
            if (!result.attachment) throw Error("No chat history to fork");
            return result.attachment;
          }
        : null,
    setThinking:
      features?.agentThinkingUpdate === true
        ? async (agentId, optionId) => {
            const notice = await daemon.setAgentThinkingOption(
              agentId,
              optionId,
            );
            if (notice?.type === "error") throw Error(notice.message);
            return notice?.message ?? null;
          }
        : null,
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

export interface ProjectDaemon {
  getLastServerInfoMessage(): {
    features?: { projectAdd?: boolean; projectRemove?: boolean };
  } | null;
  addProject(cwd: string): Promise<{
    project: PaseoProject | null;
    error: string | null;
    errorCode?: "directory_not_found" | null;
  }>;
  removeProject(projectId: string): Promise<unknown>;
  getDirectorySuggestions(options: {
    query: string;
    includeFiles?: boolean;
    includeDirectories?: boolean;
    limit?: number;
  }): Promise<{
    entries: readonly { path: string; kind: "file" | "directory" }[];
    error: string | null;
  }>;
}
export function createProjectAdapter(daemon: ProjectDaemon): ProjectPort {
  const features = daemon.getLastServerInfoMessage()?.features;
  return {
    add:
      features?.projectAdd === true
        ? async (cwd) => {
            const result = await daemon.addProject(cwd);
            if (result.project) return result.project;
            throw Error(
              result.errorCode === "directory_not_found"
                ? `Directory not found: ${cwd}`
                : (result.error ?? "Adding the project failed"),
            );
          }
        : null,
    remove:
      features?.projectRemove === true
        ? async (projectId) => {
            await daemon.removeProject(projectId);
          }
        : null,
    async directories(query) {
      const result = await daemon.getDirectorySuggestions({
        query,
        includeDirectories: true,
        includeFiles: false,
        limit: 30,
      });
      if (result.error) throw Error(result.error);
      return result.entries.flatMap((entry) =>
        entry.kind === "directory" ? [entry.path] : [],
      );
    },
  };
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
    observe(id, receive, onError, onExit) {
      const subscription = daemon.observeTerminal(id, receive);
      const unsubscribe = subscription.subscribe({
        snapshot() {},
        update(message) {
          if (message.type !== "terminal_stream_exit") return;
          if (message.payload.error) onError(message.payload.error);
          else onExit?.();
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

type HostClient = ReturnType<typeof createHostClient>;
export interface UsageDaemon extends Pick<HostClient, "listUsageReports"> {
  getLastServerInfoMessage(): {
    features?: { usageSources?: boolean; providerUsageList?: boolean };
  } | null;
}
/** Usage meters need `usageSources` or `providerUsageList`; the client bridges the two. */
export function createUsageAdapter(daemon: UsageDaemon): UsagePort | null {
  const features = daemon.getLastServerInfoMessage()?.features;
  if (features?.usageSources !== true && features?.providerUsageList !== true)
    return null;
  return {
    async list(options = {}) {
      return (await daemon.listUsageReports(options)).reports;
    },
  };
}

export interface HistoryDaemon {
  fetchAgentHistory(
    options: Parameters<HostClient["fetchAgentHistory"]>[0],
  ): Promise<{
    entries: readonly {
      agent: PaseoAgent;
      project: { projectName: string; workspaceName?: string | null };
    }[];
    pageInfo: { hasMore: boolean };
    searchTruncated?: boolean | undefined;
  }>;
  refreshAgent(agentId: string): Promise<unknown>;
  getLastServerInfoMessage(): {
    features?: { agentHistorySearch?: boolean };
  } | null;
}
export function createHistoryAdapter(daemon: HistoryDaemon): HistoryPort {
  const searchable =
    daemon.getLastServerInfoMessage()?.features?.agentHistorySearch === true;
  return {
    searchable,
    async list(query) {
      const search = searchable ? query.trim() : "";
      const result = await daemon.fetchAgentHistory({
        filter: { includeArchived: true },
        ...(search ? { search } : {}),
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
      return {
        entries: result.entries.map((entry) => ({
          agent: entry.agent,
          projectName: entry.project.projectName,
          workspaceName: entry.project.workspaceName ?? null,
        })),
        truncated: result.pageInfo.hasMore || result.searchTruncated === true,
      };
    },
    async unarchive(agentId) {
      await daemon.refreshAgent(agentId);
    },
  };
}

export type ScheduleDaemon = Pick<
  HostClient,
  | "scheduleList"
  | "scheduleInspect"
  | "scheduleLogs"
  | "schedulePause"
  | "scheduleResume"
  | "scheduleRunOnce"
  | "scheduleDelete"
  | "scheduleCreate"
>;
function checked<T extends { error: string | null }>(payload: T): T {
  if (payload.error) throw Error(payload.error);
  return payload;
}
/** Schedule RPCs are baseline daemon requests (no server_info feature flag gates them). */
export function createScheduleAdapter(daemon: ScheduleDaemon): SchedulePort {
  return {
    list: async () => checked(await daemon.scheduleList()).schedules,
    async inspect(id) {
      const { schedule } = checked(await daemon.scheduleInspect({ id }));
      if (!schedule) throw Error("Schedule not found");
      return schedule;
    },
    logs: async (id) => checked(await daemon.scheduleLogs({ id })).runs,
    async pause(id) {
      checked(await daemon.schedulePause({ id }));
    },
    async resume(id) {
      checked(await daemon.scheduleResume({ id }));
    },
    async runOnce(id) {
      checked(await daemon.scheduleRunOnce({ id }));
    },
    async remove(id) {
      checked(await daemon.scheduleDelete({ id }));
    },
    async create(input) {
      const { schedule } = checked(
        await daemon.scheduleCreate({
          prompt: input.prompt,
          ...(input.name ? { name: input.name } : {}),
          cadence: { type: "cron", expression: input.cron },
          target: input.target,
        }),
      );
      if (!schedule) throw Error("The daemon did not create the schedule");
      return schedule;
    },
  };
}

export type TerminalListDaemon = Pick<HostClient, "listTerminals">;
/**
 * The raw listing keeps each terminal's optional `activity` (the SDK's terminal list strips it).
 * Requires `workspaceTerminals`, which `requireWorkspaceCapabilities` checks at connect.
 */
export function createTerminalListAdapter(
  daemon: TerminalListDaemon,
): TerminalListPort {
  return {
    async list() {
      const { terminals } = await daemon.listTerminals();
      return {
        entries: terminals.flatMap((terminal): TerminalEntry[] =>
          terminal.workspaceId !== undefined && terminal.cwd !== undefined
            ? [
                {
                  id: terminal.id,
                  workspaceId: terminal.workspaceId,
                  cwd: terminal.cwd,
                  name: terminal.name,
                  activity: terminal.activity ?? null,
                },
              ]
            : [],
        ),
      };
    },
  };
}
