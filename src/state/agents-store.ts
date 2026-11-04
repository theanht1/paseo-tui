import type {
  PaseoAgent,
  PaseoAgentListResult,
  PaseoAgentUpdate,
} from "@getpaseo/client";
import { createEmitter } from "./emitter.js";
import type { AgentsList, AgentsPort } from "./ports.js";

export interface WorkspaceGroup {
  key: string;
  agents: readonly PaseoAgent[];
  updatedAt: string;
}
export interface AgentsSnapshot {
  groups: readonly WorkspaceGroup[];
  error: string | null;
}

function priority(agent: PaseoAgent): number {
  const active =
    agent.status === "running" || agent.pendingPermissions.length > 0;
  return active ? 0 : 1;
}
function groupAgents(agents: Iterable<PaseoAgent>): WorkspaceGroup[] {
  const groups = new Map<string, PaseoAgent[]>();
  for (const agent of agents) {
    if (agent.archivedAt != null) continue;
    const key = agent.workspaceId ?? agent.cwd;
    const group = groups.get(key) ?? [];
    group.push(agent);
    groups.set(key, group);
  }
  const view: WorkspaceGroup[] = [];
  for (const [key, agents] of groups) {
    agents.sort(
      (a, b) =>
        priority(a) - priority(b) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.id.localeCompare(b.id),
    );
    let updatedAt = agents[0].updatedAt;
    for (const agent of agents) {
      if (Date.parse(agent.updatedAt) > Date.parse(updatedAt))
        updatedAt = agent.updatedAt;
    }
    view.push({ key, agents, updatedAt });
  }
  return view.sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.key.localeCompare(b.key),
  );
}

export function createAgentsStore(port: AgentsPort) {
  const emitter = createEmitter();
  let agents = new Map<string, PaseoAgent>();
  let snapshot: AgentsSnapshot = { groups: [], error: null };
  let closed = false;
  let subscription: AgentsList["subscription"] | null = null;
  let stopSnapshots: (() => void) | null = null;
  let stopUpdates: (() => void) | null = null;
  let pending: PaseoAgentUpdate[] | null = null;
  let loading: Promise<void> | null = null;

  function publish() {
    snapshot = { groups: groupAgents(agents.values()), error: null };
    emitter.notify();
  }
  function apply(update: PaseoAgentUpdate) {
    switch (update.kind) {
      case "upsert":
        agents.set(update.agent.id, update.agent);
        break;
      case "remove":
        agents.delete(update.agentId);
        break;
      default:
        return;
    }
  }
  function replace(list: Pick<PaseoAgentListResult, "entries">) {
    agents = new Map(list.entries.map(({ agent }) => [agent.id, agent]));
    if (pending) for (const update of pending) apply(update);
    publish();
  }
  function onUpdate(update: PaseoAgentUpdate) {
    if (closed) return;
    if (pending) {
      pending.push(update);
      return;
    }
    apply(update);
    publish();
  }
  async function refresh() {
    pending = [];
    try {
      const result = await port.list();
      if (closed) {
        await result.subscription.release();
        return;
      }
      stopSnapshots?.();
      await subscription?.release();
      if (closed) {
        await result.subscription.release();
        return;
      }
      subscription = result.subscription;
      replace(result);
      stopSnapshots = subscription.subscribe({
        snapshot: (list) => {
          if (!closed) replace(list);
        },
        update: () => {},
        error: (error) => {
          if (closed) return;
          snapshot = { ...snapshot, error: String(error) };
          emitter.notify();
        },
      });
      // Attaching an owned observer synchronously replays its original snapshot.
      pending = null;
    } catch (error) {
      if (closed) return;
      if (pending) for (const update of pending) apply(update);
      snapshot = { groups: groupAgents(agents.values()), error: String(error) };
      emitter.notify();
    } finally {
      pending = null;
    }
  }
  function resync(): Promise<void> {
    if (closed) return Promise.resolve();
    if (loading) return loading;
    if (!stopUpdates) stopUpdates = port.onUpdate(onUpdate);
    loading = refresh().finally(() => {
      loading = null;
    });
    return loading;
  }
  function getSnapshot() {
    return snapshot;
  }
  async function close() {
    if (closed) return;
    closed = true;
    stopUpdates?.();
    stopSnapshots?.();
    emitter.clear();
    await subscription?.release();
  }
  return {
    getSnapshot,
    subscribe: emitter.subscribe,
    load: resync,
    resync,
    close,
  };
}
