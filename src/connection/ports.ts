import type {
  ConnectionState,
  PaseoAgent,
  PaseoAgentHandle,
  PaseoProject,
  PaseoProviderSnapshotResult,
  TerminalStreamEvent,
} from "@getpaseo/client";
import type {
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
  UsageReportEntry,
} from "@getpaseo/protocol/messages";
import type {
  ScheduleRun,
  ScheduleSummary,
  StoredSchedule,
} from "@getpaseo/protocol/schedule/types";
import type { TerminalActivity } from "@getpaseo/protocol/terminal-activity";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";

export type {
  ScheduleRun,
  ScheduleSummary,
  StoredSchedule,
  TerminalActivity,
  UsageReportEntry,
  WorkspaceLabelDefinition,
};
export interface HistoryEntry {
  agent: PaseoAgent;
  projectName: string | null;
  workspaceName: string | null;
}
export interface HistoryPage {
  entries: HistoryEntry[];
  truncated: boolean;
}
/** Past sessions, archived ones included, newest first. */
export interface HistoryPort {
  /** False when the daemon lacks `agentHistorySearch`; `list` then ignores `query`. */
  searchable: boolean;
  list(query: string): Promise<HistoryPage>;
  unarchive(agentId: string): Promise<void>;
}
/** Workspace read state; `markUnread` is null without the daemon's `workspaceMarkUnread`. */
export interface WorkspaceReadPort {
  markRead(workspaceIds: readonly string[]): Promise<void>;
  markUnread: ((workspaceId: string) => Promise<void>) | null;
}
/** Pins a workspace to the sidebar top; absent without the daemon's `workspacePinning`. */
export interface WorkspacePinPort {
  setPinned(workspaceId: string, pinned: boolean): Promise<void>;
}
/** Provider usage/quota reports; absent unless the daemon has `usageSources` or `providerUsageList`. */
export interface UsagePort {
  /** `forceRefresh` bypasses the daemon's five-minute report cache. */
  list(options?: { forceRefresh?: boolean }): Promise<UsageReportEntry[]>;
}
export interface NewAgentScheduleConfig {
  provider: string;
  cwd: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  title?: string | null;
}
export type ScheduleTargetInput =
  | { type: "agent"; agentId: string }
  | { type: "new-agent"; config: NewAgentScheduleConfig };
export interface CreateScheduleInput {
  name: string | null;
  prompt: string;
  /** Five-field cron expression; the client only sends cron cadences. */
  cron: string;
  target: ScheduleTargetInput;
}
/** Daemon schedules: baseline RPCs, no server_info feature flag gates them. */
export interface SchedulePort {
  list(): Promise<ScheduleSummary[]>;
  inspect(id: string): Promise<StoredSchedule>;
  logs(id: string): Promise<ScheduleRun[]>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  runOnce(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  create(input: CreateScheduleInput): Promise<ScheduleSummary>;
}
/** A workspace terminal plus its daemon-reported activity (null while unknown). */
export interface TerminalEntry {
  id: string;
  workspaceId: string;
  cwd: string;
  name: string;
  activity: TerminalActivity | null;
}
export interface TerminalListPort {
  list(): Promise<{ entries: TerminalEntry[] }>;
}

export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind: "command" | "skill";
}
export interface FileEntry {
  path: string;
  kind: "file" | "directory";
}
/** Provider settings for listing commands before an agent exists (new workspace/tab prompt). */
export interface DraftCommandConfig {
  provider: string;
  cwd: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
}
export type CommandListSource =
  | { kind: "agent"; agentId: string }
  | { kind: "draft"; config: DraftCommandConfig };
export interface CompletionPort {
  commands(source: CommandListSource): Promise<SlashCommand[]>;
  files(cwd: string, query: string): Promise<FileEntry[]>;
  /** A completion session starts for this source; a caching port drops answers from earlier ones. */
  opened?(source: CommandListSource): void;
}
export interface TerminalStreamPort {
  /** `onExit` runs as soon as the terminal's process exits cleanly, before the daemon's lists catch up. */
  observe(
    id: string,
    receive: (event: TerminalStreamEvent) => void,
    onError: (error: unknown) => void,
    onExit?: () => void,
  ): { ready: Promise<void>; close(): Promise<void> };
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
}
export interface DirectoryPort {
  list(
    directory: string,
  ): Promise<readonly { name: string; kind: "file" | "directory" }[]>;
}

export type AgentTimelinePage = Awaited<
  ReturnType<PaseoAgentHandle["timeline"]["refetch"]>
>;
export type TimelineCursor = NonNullable<AgentTimelinePage["endCursor"]>;
export type ProviderSubagent = ProviderSubagentDescriptorPayload;

export type ProviderSubagentUpdate = Extract<
  SessionOutboundMessage,
  { type: "agent.provider_subagents.update" }
>["payload"];
type TimelinePayload = Extract<
  SessionOutboundMessage,
  { type: "agent.provider_subagents.timeline.get.response" }
>["payload"];
export type ProviderSubagentTimelinePage = Pick<
  TimelinePayload,
  | "epoch"
  | "error"
  | "reset"
  | "staleCursor"
  | "gap"
  | "hasNewer"
  | "endCursor"
  | "window"
> & {
  rows: readonly Pick<
    TimelinePayload["rows"][number],
    "seq" | "seqEnd" | "timestamp" | "item"
  >[];
};
export type ProviderSnapshotEntry =
  PaseoProviderSnapshotResult["entries"][number];
/** The daemon's provider snapshot (`providersSnapshot`, checked at connect). */
export interface ProviderCatalogPort {
  snapshot(): Promise<readonly ProviderSnapshotEntry[]>;
  /** Asks the daemon to detect providers again; changes arrive through `observe`. */
  refresh(): Promise<void>;
  /** Pushed snapshots; the returned stop resolves once the daemon released it. */
  observe(
    handler: (entries: readonly ProviderSnapshotEntry[]) => void,
  ): () => Promise<void>;
}
export interface ProviderSubagentPort {
  list(parentAgentId: string): Promise<ProviderSubagent[]>;
  observe(handler: (update: ProviderSubagentUpdate) => void): () => void;
  timeline(
    parentAgentId: string,
    subagentId: string,
    options: {
      direction: "tail" | "after";
      limit: number;
      cursor?: TimelineCursor;
    },
  ): Promise<ProviderSubagentTimelinePage>;
}

export type RewindMode = "conversation" | "files" | "both";
/** Daemon-side matches across the whole history, oldest first (seq of each matching message). */
export interface TimelineSearchResult {
  epoch: string;
  seqs: readonly number[];
  /** More matches exist than were collected. */
  truncated: boolean;
}
export interface TimelinePrompt {
  seq: number;
  timestamp: string;
  preview: string;
}
export interface TimelinePromptIndex {
  epoch: string;
  prompts: readonly TimelinePrompt[];
}
type ForkContextPayload = Extract<
  SessionOutboundMessage,
  { type: "agent.fork_context.response" }
>["payload"];
export type ForkAttachment = NonNullable<ForkContextPayload["attachment"]>;
/** Agent operations gated on `server_info.features`; each is null when the daemon lacks it. */
export interface AgentFeaturesPort {
  /** `agentHistorySearch` */
  search:
    | ((agentId: string, query: string) => Promise<TimelineSearchResult>)
    | null;
  /** `agentTimelinePromptIndex` */
  prompts: ((agentId: string) => Promise<TimelinePromptIndex>) | null;
  /** `rewind` */
  rewind:
    | ((agentId: string, messageId: string, mode: RewindMode) => Promise<void>)
    | null;
  /** `agentForkContext` and `agentForkContextCursor`; a null boundary forks the whole chat. */
  forkContext:
    | ((
        agentId: string,
        boundary: TimelineCursor | null,
      ) => Promise<ForkAttachment>)
    | null;
  /** `agentThinkingUpdate`; resolves to the provider's notice, if any. */
  setThinking:
    | ((agentId: string, optionId: string) => Promise<string | null>)
    | null;
}
/** Project registry operations; `add` and `remove` are null when the daemon lacks `projectAdd` / `projectRemove`. */
export interface ProjectPort {
  add: ((cwd: string) => Promise<PaseoProject>) | null;
  remove: ((projectId: string) => Promise<void>) | null;
  /** Directories on the host matching `query`, best first. */
  directories(query: string): Promise<string[]>;
}
/** What the window shows of a daemon connection beyond its state. */
export interface HostInfoPort {
  /** `server_info.version`; null while disconnected or unreported. */
  version(): string | null;
  /** Retries a dropped connection now instead of after the client's backoff. */
  reconnect(): void;
}
/** The client's connection state, with the retry details the public type leaves out. */
export type HostConnectionState =
  | Exclude<ConnectionState, { status: "disconnected" }>
  | {
      status: "disconnected";
      reason?: string;
      /** When the client library retries; absent once it stopped retrying. */
      nextRetryAt?: string;
      failureCode?: string;
    };
/** A label catalog listing: a full `snapshot`, or the `changes` after a sync cursor. */
export type WorkspaceLabelList = Extract<
  SessionOutboundMessage,
  { type: "workspace.label.list.response" }
>["payload"];
/** One pushed catalog change, numbered `seq` within `generation`. */
export type WorkspaceLabelChange = Extract<
  SessionOutboundMessage,
  { type: "workspace.label.update" }
>["payload"];
export interface WorkspaceLabelCursor {
  generation: string;
  afterSeq: number;
}
export interface WorkspaceLabelObserver {
  list(payload: WorkspaceLabelList): void;
  change(change: WorkspaceLabelChange): void;
  error(error: unknown): void;
}
/** A host's workspace label catalog (`workspaceLabels`). */
export interface WorkspaceLabelPort {
  /** The whole catalog, or only what changed after `sync`. */
  list(sync?: WorkspaceLabelCursor): Promise<WorkspaceLabelList>;
  /** The catalog snapshot (again after each reconnect), then its changes; stop resolves once released. */
  observe(observer: WorkspaceLabelObserver): () => Promise<void>;
  /** Assigns or unassigns a label, creating it when the catalog lacks it; resolves to the workspace's labels. */
  setAssignment(input: {
    workspaceId: string;
    label: WorkspaceLabelDefinition;
    assigned: boolean;
  }): Promise<readonly string[]>;
  /** Renames and/or recolors in one request; omitted fields are left alone. */
  update(input: WorkspaceLabelEdit): Promise<WorkspaceLabelDefinition>;
  /** How many workspaces deleting the label would unassign. */
  inspectDelete(name: string): Promise<number>;
  /** Deletes the label; resolves to how many workspaces lost it. */
  delete(name: string): Promise<number>;
}
export interface WorkspaceLabelEdit {
  name: string;
  newName?: string;
  color?: WorkspaceLabelDefinition["color"];
}
