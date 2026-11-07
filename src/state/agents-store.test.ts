import type {
  PaseoAgent,
  PaseoAgentListResult,
  PaseoAgentUpdate,
  SubscriptionObserver,
} from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { agent, listSnapshot } from "../test/fixtures.js";
import { createAgentsStore } from "./agents-store.js";
import type { AgentsList, AgentsPort } from "./ports.js";

class FakeAgents implements AgentsPort {
  async providers() {
    return [];
  }
  async models() {
    return [];
  }
  async modes() {
    return [];
  }
  onProvidersChange() {
    return () => {};
  }
  async create(): Promise<never> {
    throw new Error("Unexpected create");
  }
  agents: PaseoAgent[] = [];
  updates = new Set<(update: PaseoAgentUpdate) => void>();
  observers = new Set<
    SubscriptionObserver<PaseoAgentListResult & { subscriptionId: string }>
  >();
  releases = 0;
  duringList: (() => void) | null = null;
  async list(): Promise<AgentsList> {
    const initial = listSnapshot(this.agents);
    this.duringList?.();
    return {
      ...initial,
      subscription: {
        release: async () => {
          this.releases++;
        },
        subscribe: (observer) => {
          this.observers.add(observer);
          observer.snapshot(initial);
          return () => {
            this.observers.delete(observer);
          };
        },
      },
    };
  }
  onUpdate(handler: (update: PaseoAgentUpdate) => void) {
    this.updates.add(handler);
    return () => {
      this.updates.delete(handler);
    };
  }
  push(update: PaseoAgentUpdate) {
    for (const handler of this.updates) handler(update);
  }
  restore(agents: PaseoAgent[]) {
    for (const observer of this.observers)
      observer.snapshot(listSnapshot(agents));
  }
}

describe("agents store", () => {
  it("preserves updates received during list across the owned snapshot replay", async () => {
    const port = new FakeAgents();
    port.agents = [agent("a")];
    port.duringList = () => {
      port.push({ kind: "upsert", agent: agent("a", { status: "running" }) });
      port.push({ kind: "upsert", agent: agent("new") });
    };
    const store = createAgentsStore(port);
    await store.load();
    expect(
      store
        .getSnapshot()
        .groups[0]?.agents.map((value) => [value.id, value.status]),
    ).toEqual([
      ["a", "running"],
      ["new", "idle"],
    ]);
  });

  it("sorts timestamps by instant across timezone offsets", async () => {
    const port = new FakeAgents();
    port.agents = [
      agent("older", { updatedAt: "2026-11-03T05:00:00+10:00" }),
      agent("newer", { updatedAt: "2026-11-03T01:00:00Z" }),
      agent("other", {
        workspaceId: "other",
        updatedAt: "2026-11-03T02:00:00Z",
      }),
    ];
    const store = createAgentsStore(port);
    await store.load();
    expect(store.getSnapshot().groups.map((group) => group.key)).toEqual([
      "other",
      "workspace",
    ]);
    expect(
      store.getSnapshot().groups[1]?.agents.map((value) => value.id),
    ).toEqual(["newer", "older"]);
  });

  it("seeds groups by workspace or cwd and sorts by activity and priority", async () => {
    const port = new FakeAgents();
    port.agents = [
      agent("idle", { updatedAt: "2026-11-03T00:00:00Z" }),
      agent("running", { status: "running" }),
      agent("permission", {
        pendingPermissions: [
          { id: "p", name: "tool", kind: "tool", provider: "codex" },
        ],
        updatedAt: "2026-11-02T00:00:00Z",
      }),
      agent("other", {
        workspaceId: undefined,
        cwd: "/other",
        updatedAt: "2026-11-04T00:00:00Z",
      }),
    ];
    const store = createAgentsStore(port);
    await store.load();
    expect(store.getSnapshot().groups.map((g) => g.key)).toEqual([
      "/other",
      "workspace",
    ]);
    expect(store.getSnapshot().groups[1]?.agents.map((a) => a.id)).toEqual([
      "permission",
      "running",
      "idle",
    ]);
  });
  it("upserts new agents, replaces status and resorts, removes, and hides archives", async () => {
    const port = new FakeAgents();
    port.agents = [
      agent("a"),
      agent("b", { updatedAt: "2026-11-02T00:00:00Z" }),
    ];
    const store = createAgentsStore(port);
    await store.load();
    port.push({ kind: "upsert", agent: agent("c") });
    expect(store.getSnapshot().groups[0]?.agents).toHaveLength(3);
    port.push({ kind: "upsert", agent: agent("a", { status: "running" }) });
    expect(store.getSnapshot().groups[0]?.agents[0]?.id).toBe("a");
    port.push({ kind: "remove", agentId: "b" });
    port.push({
      kind: "upsert",
      agent: agent("c", { archivedAt: "2026-11-03" }),
    });
    expect(store.getSnapshot().groups[0]?.agents.map((a) => a.id)).toEqual([
      "a",
    ]);
  });
  it("ignores unknown fields and replaces stale entries on reconnect snapshots", async () => {
    const port = new FakeAgents();
    const future = { ...agent("old"), futureField: 42 };
    port.agents = [future];
    const store = createAgentsStore(port);
    await store.load();
    expect(store.getSnapshot().groups[0]?.agents[0]?.id).toBe("old");
    port.restore([agent("new")]);
    expect(store.getSnapshot().groups[0]?.agents.map((a) => a.id)).toEqual([
      "new",
    ]);
    port.agents = [agent("resynced")];
    await store.resync();
    expect(store.getSnapshot().groups[0]?.agents[0]?.id).toBe("resynced");
    expect(port.releases).toBe(1);
  });
  it("keeps snapshots stable, notifies changes, and releases listeners on close", async () => {
    const port = new FakeAgents();
    const store = createAgentsStore(port);
    let changes = 0;
    store.subscribe(() => changes++);
    await store.load();
    const snapshot = store.getSnapshot();
    const changesAfterLoad = changes;
    expect(store.getSnapshot()).toBe(snapshot);
    port.push({ kind: "upsert", agent: agent("a") });
    expect(changes).toBe(changesAfterLoad + 1);
    await store.close();
    expect(port.updates.size).toBe(0);
    expect(port.observers.size).toBe(0);
    expect(port.releases).toBe(1);
  });
});
