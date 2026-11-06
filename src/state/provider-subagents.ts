import type {
  ProviderSubagent,
  ProviderSubagentPort,
  ProviderSubagentTimelinePage,
  ProviderSubagentUpdate,
} from "../connection/ports.js";
import { createEmitter } from "./emitter.js";
import type { AgentPort, TimelinePage } from "./ports.js";

type TimelineUpdate = Extract<ProviderSubagentUpdate, { kind: "timeline" }>;
function key(parentAgentId: string, subagentId: string) {
  return `${parentAgentId}\0${subagentId}`;
}
function page(result: ProviderSubagentTimelinePage): TimelinePage {
  return {
    epoch: result.epoch,
    error: result.error,
    reset: result.reset,
    staleCursor: result.staleCursor,
    gap: result.gap,
    hasNewer: result.hasNewer,
    endCursor: result.endCursor ?? null,
    window: result.window,
    agent: null,
    entries: result.rows.map((row) => ({
      seqEnd: row.seqEnd ?? row.seq,
      timestamp: row.timestamp,
      item: row.item,
    })),
  };
}
const READ_ONLY = "Subagent chats are read-only; open the parent to reply.";

/** Provider-owned subagents of tracked parents, kept live from `agent.provider_subagents.update`. */
export function createProviderSubagentStore(port: ProviderSubagentPort) {
  const emitter = createEmitter();
  const descriptors = new Map<string, ProviderSubagent>();
  const tracked = new Set<string>();
  const timelines = new Map<string, Set<(update: TimelineUpdate) => void>>();
  let snapshot: readonly ProviderSubagent[] = [];
  function publish() {
    snapshot = [...descriptors.values()];
    emitter.notify();
  }
  const release = port.observe((update) => {
    switch (update.kind) {
      case "upsert":
        descriptors.set(
          key(update.subagent.parentAgentId, update.subagent.id),
          update.subagent,
        );
        publish();
        return;
      case "remove":
        descriptors.delete(key(update.parentAgentId, update.subagentId));
        publish();
        return;
      case "timeline":
        for (const listener of timelines.get(
          key(update.parentAgentId, update.subagentId),
        ) ?? [])
          listener(update);
        return;
    }
  });
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    track(parentAgentId: string) {
      if (tracked.has(parentAgentId)) return;
      tracked.add(parentAgentId);
      port.list(parentAgentId).then(
        (list) => {
          for (const [id, descriptor] of descriptors)
            if (descriptor.parentAgentId === parentAgentId)
              descriptors.delete(id);
          for (const descriptor of list)
            descriptors.set(key(parentAgentId, descriptor.id), descriptor);
          publish();
        },
        () => {
          tracked.delete(parentAgentId);
        },
      );
    },
    /** A read-only AgentPort over the child's projected timeline. */
    timelinePort(parentAgentId: string, subagentId: string): AgentPort {
      const reject = async (): Promise<never> => {
        throw Error(READ_ONLY);
      };
      return {
        fetchTail: async (limit) =>
          page(
            await port.timeline(parentAgentId, subagentId, {
              direction: "tail",
              limit,
            }),
          ),
        fetchAfter: async (cursor, limit) =>
          page(
            await port.timeline(parentAgentId, subagentId, {
              direction: "after",
              limit,
              cursor,
            }),
          ),
        subscribe(handler) {
          const id = key(parentAgentId, subagentId);
          const listener = (update: TimelineUpdate) =>
            handler({
              agentId: subagentId,
              epoch: update.epoch,
              seq: update.seq,
              timestamp: update.timestamp,
              event: {
                type: "timeline",
                provider: update.provider,
                item: update.item,
              },
            });
          const listeners = timelines.get(id) ?? new Set();
          listeners.add(listener);
          timelines.set(id, listeners);
          return Object.assign(
            () => {
              listeners.delete(listener);
            },
            { ready: Promise.resolve() },
          );
        },
        send: reject,
        steer: reject,
        interrupt: reject,
        respondToPermission: reject,
        setMode: reject,
        setModel: reject,
        rename: reject,
        archive: reject,
        cancel: reject,
        snapshot: () => null,
      };
    },
    close() {
      release();
      timelines.clear();
    },
  };
}
export type ProviderSubagentStore = ReturnType<
  typeof createProviderSubagentStore
>;
