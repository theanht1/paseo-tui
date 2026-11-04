import type {
  OwnedSubscription,
  PaseoAgent,
  PaseoAgentHandle,
  PaseoAgentListResult,
  PaseoAgentTimelineEvent,
  PaseoAgentUpdate,
  PaseoApi,
} from "@getpaseo/client";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";

export type TimelinePage = Awaited<
  ReturnType<PaseoAgentHandle["timeline"]["refetch"]>
>;
export type TimelineCursor = NonNullable<TimelinePage["endCursor"]>;
export interface AgentsList extends Omit<PaseoAgentListResult, "subscription"> {
  subscription: Pick<
    OwnedSubscription<PaseoAgentListResult>,
    "release" | "subscribe"
  >;
}
export interface AgentsPort {
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
  cancel(): Promise<void>;
  snapshot(): PaseoAgent | null;
}

export function createAgentsPort(api: PaseoApi): AgentsPort {
  return {
    list: () => api.agents.list({ subscribe: {} }),
    onUpdate: (handler) => api.agents.subscribe(handler),
  };
}
export function createAgentPort(
  handle: PaseoAgentHandle,
  cancel: () => Promise<void>,
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
    cancel,
    snapshot: () => handle.current(),
  };
}
