import type { PaseoAgentHandle, TerminalStreamEvent } from "@getpaseo/client";
import type {
  ProviderSubagentDescriptorPayload,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";

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
}
export interface TerminalStreamPort {
  observe(
    id: string,
    receive: (event: TerminalStreamEvent) => void,
    onError: (error: unknown) => void,
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
