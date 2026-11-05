import type {
  OwnedSubscription,
  PaseoAgent,
  PaseoAgentCreateOptions,
  PaseoAgentHandle,
  PaseoAgentListResult,
  PaseoAgentTimelineEvent,
  PaseoAgentUpdate,
  PaseoApi,
} from "@getpaseo/client";
import type {
  AgentPermissionResponse,
  AgentSelectOption,
} from "@getpaseo/protocol/agent-types";
import type { DaemonAdapter } from "../connection/daemon-adapter.js";
import type { AgentTimelinePage, TimelineCursor } from "../connection/ports.js";

/** The timeline fields the store reads; agent and provider-subagent pages both provide them. */
export type TimelinePage = Pick<
  AgentTimelinePage,
  | "epoch"
  | "error"
  | "endCursor"
  | "reset"
  | "staleCursor"
  | "gap"
  | "hasNewer"
  | "agent"
> & {
  window: Pick<AgentTimelinePage["window"], "maxSeq">;
  entries: readonly Pick<
    AgentTimelinePage["entries"][number],
    "seqEnd" | "timestamp" | "item"
  >[];
};
export interface AgentsList extends Omit<PaseoAgentListResult, "subscription"> {
  subscription: Pick<
    OwnedSubscription<PaseoAgentListResult>,
    "release" | "subscribe"
  >;
}
export interface CatalogProvider {
  id: string;
  label: string;
  available: boolean;
  error: string | null;
  defaultModeId: string | null;
}
export interface CatalogModel {
  id: string;
  label: string;
  description: string | null;
  isDefault: boolean;
  thinking?:
    | { kind: "options"; options: readonly AgentSelectOption[] }
    | { kind: "unsupported"; message: string };
}
export interface CatalogMode {
  id: string;
  label: string;
  description: string | null;
}
export interface CreateAgentInput {
  provider: string;
  model: string;
  modeId: string | null;
  thinkingOptionId?: string;
  cwd: string;
  title: string | null;
  prompt: string | null;
}
interface AgentsApi {
  agents: Pick<PaseoApi["agents"], "list" | "subscribe"> & {
    create(
      options: PaseoAgentCreateOptions,
    ): Promise<Pick<PaseoAgentHandle, "current">>;
  };
  providers: Pick<
    PaseoApi["providers"],
    "listAvailable" | "snapshot" | "listModels" | "listModes"
  >;
}
export interface AgentsPort {
  providers(): Promise<CatalogProvider[]>;
  models(provider: string): Promise<CatalogModel[]>;
  modes(provider: string): Promise<CatalogMode[]>;
  create(input: CreateAgentInput): Promise<PaseoAgent>;
  list(): Promise<AgentsList>;
  onUpdate(handler: (update: PaseoAgentUpdate) => void): () => void;
}
export interface AgentPort {
  fetchTail(limit: number): Promise<TimelinePage>;
  fetchAfter(cursor: TimelineCursor, limit: number): Promise<TimelinePage>;
  subscribe(
    handler: (event: PaseoAgentTimelineEvent) => void,
  ): (() => void) & { ready: Promise<void> };
  send(text: string): Promise<void>;
  respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void>;
  setMode(modeId: string): Promise<string | null>;
  setModel(modelId: string): Promise<void>;
  rename(name: string): Promise<void>;
  archive(): Promise<void>;
  cancel(): Promise<void>;
  snapshot(): PaseoAgent | null;
}

export function createAgentsPort(
  api: AgentsApi,
  thinkingSupported = false,
): AgentsPort {
  return {
    async providers() {
      const [available, snapshot] = await Promise.all([
        api.providers.listAvailable(),
        api.providers.snapshot(),
      ]);
      const entries = new Map(
        snapshot.entries.map((entry) => [entry.provider, entry]),
      );
      return available.providers.map((provider) => {
        const entry = entries.get(provider.provider);
        return {
          id: provider.provider,
          label:
            typeof entry?.label === "string" ? entry.label : provider.provider,
          available: provider.available,
          error: typeof provider.error === "string" ? provider.error : null,
          defaultModeId:
            typeof entry?.defaultModeId === "string"
              ? entry.defaultModeId
              : null,
        };
      });
    },
    async models(provider) {
      const result = await api.providers.listModels(provider);
      if (result.error) throw new Error(result.error);
      return (result.models ?? []).map((model) => ({
        id: model.id,
        label: model.label,
        description:
          typeof model.description === "string" ? model.description : null,
        isDefault: model.isDefault === true,
        ...(model.thinkingOptions?.length
          ? {
              thinking: thinkingSupported
                ? { kind: "options" as const, options: model.thinkingOptions }
                : {
                    kind: "unsupported" as const,
                    message:
                      "Update the Paseo daemon to configure thinking (agentThinkingUpdate required).",
                  },
            }
          : {}),
      }));
    },
    async modes(provider) {
      const result = await api.providers.listModes(provider);
      if (result.error) throw new Error(result.error);
      return (result.modes ?? []).map((mode) => ({
        id: mode.id,
        label: mode.label,
        description:
          typeof mode.description === "string" ? mode.description : null,
      }));
    },
    async create(input) {
      const options: PaseoAgentCreateOptions = {
        config: {
          provider: `${input.provider}/${input.model}`,
        },
        cwd: input.cwd,
      };
      if (input.thinkingOptionId !== undefined) {
        if (!thinkingSupported)
          throw Error(
            "Update the Paseo daemon to configure thinking (agentThinkingUpdate required).",
          );
        options.config.thinkingOptionId = input.thinkingOptionId;
      }
      if (input.modeId !== null) options.config.modeId = input.modeId;
      if (input.title !== null) options.title = input.title;
      if (input.prompt !== null) options.prompt = input.prompt;
      const handle = await api.agents.create(options);
      const current = handle.current();
      if (current === null) throw new Error("Agent created but no snapshot");
      return current;
    },
    list: () => api.agents.list({ subscribe: {} }),
    onUpdate: (handler) => api.agents.subscribe(handler),
  };
}
export function createAgentPort(
  handle: PaseoAgentHandle,
  daemon: DaemonAdapter,
): AgentPort {
  return {
    fetchTail: (limit) =>
      handle.timeline.refetch({
        direction: "tail",
        limit,
        projection: "canonical",
      }),
    fetchAfter: (cursor, limit) =>
      handle.timeline.refetch({
        direction: "after",
        cursor,
        limit,
        projection: "canonical",
      }),
    subscribe: (handler) => handle.timeline.subscribe(handler),
    send: (text) => handle.send(text),
    respondToPermission: (requestId, response) =>
      handle.respondToPermission({ requestId, response }),
    cancel: () => daemon.cancelAgent(handle.id),
    setMode: (id) => daemon.setAgentMode(handle.id, id),
    setModel: (id) => daemon.setAgentModel(handle.id, id),
    rename: (name) => daemon.renameAgent(handle.id, name),
    async archive() {
      await handle.archive();
    },
    snapshot: () => handle.current(),
  };
}
