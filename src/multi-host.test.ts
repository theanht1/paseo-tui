import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import { expect, it } from "vitest";
import type {
  HostConnectionState,
  SchedulePort,
  WorkspaceLabelDefinition,
} from "./connection/ports.js";
import type { LiveHost } from "./hosts.js";
import {
  createMultiHost,
  type HostSession,
  windowLabel,
} from "./multi-host.js";
import { createEmitter } from "./state/emitter.js";
import type {
  LabelCatalog,
  LabelCatalogSnapshot,
} from "./state/label-catalog.js";
import type { UsageSnapshot, UsageStore } from "./state/usage-store.js";
import { agent, NO_PROJECT_ACTIONS, timelineStore } from "./test/fixtures.js";
import { createManagementController } from "./ui/management-controller.js";
import type { ExternalStore } from "./ui/use-store.js";
import type { DirectorySnapshot } from "./ui/workspace/workspace-directory.js";
import type { WorkspaceRow } from "./ui/workspace/workspaces.js";

function fixed<T>(value: T): ExternalStore<T> {
  return { subscribe: () => () => {}, getSnapshot: () => value };
}
function project(projectId: string, key: string): PaseoProject {
  return {
    projectId,
    projectDisplayName: "app",
    projectRootPath: `/src/${projectId}`,
    projectKind: "git",
    projectKey: key,
  };
}
function row(id: string, projectId: string): WorkspaceRow {
  return {
    id,
    projectId,
    projectRootPath: "/src",
    activityAt: null,
    statusEnteredAt: null,
    workspaceDirectory: `/src/${id}`,
    name: id,
  };
}
function unexpected(): never {
  throw Error("Unexpected");
}
function host(
  id: string,
  options: {
    agents: PaseoAgent[];
    directory: Omit<DirectorySnapshot, "error">;
    calls: string[];
    historyFails?: boolean;
    status?: ExternalStore<HostConnectionState>;
    error?: string;
    schedules?: SchedulePort;
    usage?: UsageStore;
    labels?: LabelCatalog;
  },
): LiveHost<{ session: HostSession }> {
  const { calls } = options;
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push(
        `${id}.${name}(${args
          .map((arg) =>
            typeof arg === "object" && arg && "key" in arg
              ? String(arg.key)
              : typeof arg === "object" && arg && "id" in arg
                ? String(arg.id)
                : JSON.stringify(arg),
          )
          .join(", ")})`,
      );
    };
  const session: HostSession = {
    status: options.status ?? fixed({ status: "connected" }),
    agents: fixed({
      groups: options.agents.map((a) => ({
        key: a.workspaceId ?? a.cwd,
        agents: [a],
        updatedAt: a.updatedAt,
      })),
      error: options.error ?? null,
    }),
    directory: fixed({ ...options.directory, error: options.error ?? null }),
    terminals: { ref: unexpected },
    terminalStream: {
      observe: unexpected,
      write: (terminal, data) => {
        calls.push(`${id}.write(${terminal}, ${data})`);
      },
      resize: unexpected,
    },
    management: {
      ...NO_PROJECT_ACTIONS,
      directories: async (query) => [`${id}:${query}`],
      removeProject: async (p, workspaces) => {
        calls.push(
          `${id}.removeProject(${p.projectId}, ${workspaces.map((w) => w.id).join(" ")})`,
        );
      },
      baseBranches: unexpected,
      createWorkspace: unexpected,
      createAgent: unexpected,
      createTerminal: unexpected,
      openFile: unexpected,
      renameWorkspace: record("renameWorkspace"),
      renameTab: record("renameTab"),
      closeTab: record("closeTab"),
      archiveWorkspace: record("archiveWorkspace"),
    },
    agentsPort: {
      providers: unexpected,
      models: unexpected,
      modes: unexpected,
      onProvidersChange() {
        calls.push(`${id}.onProvidersChange()`);
        return () => {};
      },
      create: unexpected,
    },
    clearAttention: record("clearAttention"),
    refresh: record("refresh"),
    refreshProviders: record("refreshProviders"),
    openTimeline(opened) {
      calls.push(`${id}.openTimeline(${opened.id})`);
      return timelineStore();
    },
    completions: { commands: unexpected, files: unexpected },
    directories: { list: unexpected },
    history: {
      searchable: id === "home",
      async list() {
        if (id === "build" && options.historyFails) throw Error("offline");
        return {
          entries: [
            {
              agent: agent(`h-${id}`, {
                updatedAt:
                  id === "home"
                    ? "2026-11-01T00:00:00Z"
                    : "2026-11-03T00:00:00Z",
              }),
              projectName: id,
              workspaceName: null,
            },
          ],
          truncated: id === "home",
        };
      },
      async unarchive(agentId) {
        calls.push(`${id}.unarchive(${agentId})`);
      },
    },
    workspaceRead: {
      async markRead(ids) {
        calls.push(`${id}.markRead(${ids.join(" ")})`);
      },
      markUnread:
        id === "home"
          ? async (workspaceId) => {
              calls.push(`${id}.markUnread(${workspaceId})`);
            }
          : null,
    },
    workspacePins:
      id === "home"
        ? {
            async setPinned(workspaceId, pinned) {
              calls.push(`${id}.setPinned(${workspaceId}, ${pinned})`);
            },
          }
        : null,
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.labels ? { labels: options.labels } : {}),
    schedules: options.schedules ?? {
      list: unexpected,
      inspect: unexpected,
      logs: unexpected,
      pause: unexpected,
      resume: unexpected,
      runOnce: unexpected,
      remove: unexpected,
      create: unexpected,
    },
  };
  return { id, label: id === "home" ? "local" : "Build", live: { session } };
}
/** The configured hosts, as hosts.ts's health list names them. */
function expected(ids: readonly string[]) {
  return fixed(ids.map((id) => ({ id })));
}
function setup(
  options: {
    historyFails?: boolean;
    status?: ExternalStore<HostConnectionState>;
    localStatus?: ExternalStore<HostConnectionState>;
    error?: string;
    labels?: LabelCatalog;
  } = {},
) {
  const calls: string[] = [];
  const local = host("home", {
    ...(options.localStatus ? { status: options.localStatus } : {}),
    agents: [
      agent("a1", { workspaceId: "w1", updatedAt: "2026-11-01T00:00:00Z" }),
    ],
    directory: {
      projects: [project("p1", "github.com/me/app")],
      workspaces: [row("w1", "p1")],
      terminals: [],
    },
    calls,
  });
  const build = host("build", {
    agents: [
      agent("a2", { workspaceId: "w2", updatedAt: "2026-11-02T00:00:00Z" }),
    ],
    directory: {
      projects: [project("p9", "github.com/me/app")],
      workspaces: [row("w2", "p9")],
      terminals: [{ id: "t2", workspaceId: "w2", cwd: "/src", name: "zsh" }],
    },
    calls,
    ...options,
  });
  const emitter = createEmitter();
  let live = [local, build];
  const hosts = {
    subscribe: emitter.subscribe,
    getSnapshot: () => live,
    set(next: typeof live) {
      live = next;
      emitter.notify();
    },
    health: expected(["home", "build"]),
  };
  return { multi: createMultiHost(hosts), hosts, calls, local };
}

it("shows every host's agents and workspaces, tagging each workspace with its host", () => {
  const { multi } = setup();
  expect(multi.agents.getSnapshot().groups.map((group) => group.key)).toEqual([
    "w2",
    "w1",
  ]);
  const directory = multi.directory.getSnapshot();
  expect(directory.projects.map((p) => p.projectId)).toEqual([
    "github.com/me/app",
  ]);
  expect(directory.workspaces.map((w) => [w.id, w.projectId])).toEqual([
    ["w1", "github.com/me/app"],
    ["w2", "github.com/me/app"],
  ]);
  expect([...(directory.hosts?.labels ?? [])]).toEqual([
    ["w1", "local"],
    ["w2", "Build"],
  ]);
  expect(directory.terminals.map((t) => t.id)).toEqual(["t2"]);
});

it("drops the host tags when only one host is connected", () => {
  const { multi, hosts, local } = setup();
  hosts.set([local]);
  expect(multi.directory.getSnapshot().hosts).toBeUndefined();
  expect(multi.directory.getSnapshot().workspaces.map((w) => w.id)).toEqual([
    "w1",
  ]);
});

it("sends a merged project's actions to its host when only one host is connected", async () => {
  const { multi, hosts, local, calls } = setup();
  hosts.set([local]);
  const project = multi.directory.getSnapshot().projects[0];
  const [w1] = multi.directory.getSnapshot().workspaces;
  if (!project || !w1) throw Error("missing project");
  expect(project.projectId).toBe("github.com/me/app");
  await expect(multi.management.baseBranches(project)).rejects.toThrow(
    "Unexpected",
  );
  await multi.management.removeProject(project, [w1]);
  expect(calls).toEqual(["home.removeProject(p1, w1)"]);
});
it("lists base branches for New workspace › Worktree when only one host is connected", async () => {
  const { multi, hosts, local } = setup();
  hosts.set([local]);
  local.live.session.management.baseBranches = async (project) => ({
    branches: [`${project.projectId}:main`],
    defaultBranch: `${project.projectId}:main`,
  });
  const controller = createManagementController(() => ({
    projects: multi.directory.getSnapshot().projects,
    agents: [],
    workspaces: multi.directory.getSnapshot().workspaces,
    workspace: null,
    tab: null,
    catalog: null,
    actions: multi.management,
    refresh: async () => {},
    opened() {},
  }));
  controller.createWorkspace(multi.directory.getSnapshot().projects[0]);
  const state = controller.getSnapshot();
  if (state.overlay.kind !== "wizard") throw Error("Expected wizard");
  const placement = state.overlay.step;
  if (placement.kind !== "choice") throw Error("Expected placement");
  const worktree = (await placement.items())
    .find((item) => item.title === "Worktree")
    ?.run();
  if (worktree?.kind !== "choice") throw Error("Expected base branches");
  expect((await worktree.items()).map((item) => item.title)).toEqual([
    "p1:main",
  ]);
});
it("sends each action to the host that owns its workspace, agent or terminal", async () => {
  const { multi, calls } = setup();
  const [w1, w2] = multi.directory.getSnapshot().workspaces;
  if (!w1 || !w2) throw Error("missing workspaces");
  await multi.management.archiveWorkspace(w2);
  await multi.management.renameWorkspace(w1, "x");
  await multi.management.closeTab({
    kind: "agent",
    key: "agent:a2",
    agent: agent("a2"),
  });
  await multi.clearAttention("a1");
  multi.terminalStream.write("t2", "ls");
  multi.timelines.acquire(agent("a2"));
  await multi.management.removeProject(
    multi.directory.getSnapshot().projects[0] as PaseoProject,
    [w1, w2],
  );
  expect(calls).toEqual([
    "build.archiveWorkspace(w2)",
    'home.renameWorkspace(w1, "x")',
    "build.closeTab(agent:a2)",
    'home.clearAttention("a1")',
    "build.write(t2, ls)",
    "build.openTimeline(a2)",
    "home.removeProject(p1, w1)",
    "build.removeProject(p9, w2)",
  ]);
});

it("sends host-less requests to the focused workspace's host", async () => {
  const { multi } = setup();
  expect(await multi.management.directories("app")).toEqual(["home:app"]);
  multi.focus("w2");
  expect(await multi.management.directories("app")).toEqual(["build:app"]);
});

it("watches the focused host's providers and refreshes every host's", async () => {
  const { multi, calls } = setup();
  multi.focus("w2");
  multi.catalog.onProvidersChange(() => {});
  await multi.refreshProviders();
  expect(calls).toEqual([
    "build.onProvidersChange()",
    "home.refreshProviders()",
    "build.refreshProviders()",
  ]);
});

it("history merges hosts newest first and routes unarchive to the owner", async () => {
  const { multi, calls } = setup();
  const history = multi.history;
  if (!history) throw Error("expected history");
  expect(history.searchable).toBe(true);
  const page = await history.list("");
  expect(page.entries.map((entry) => entry.agent.id)).toEqual([
    "h-build",
    "h-home",
  ]);
  expect(page.truncated).toBe(true);
  expect(page.hostErrors).toEqual([]);
  await history.unarchive("h-build");
  expect(calls).toEqual(["build.unarchive(h-build)"]);
});

it("history reports a failing host and still returns the others", async () => {
  const { multi } = setup({ historyFails: true });
  const history = multi.history;
  if (!history) throw Error("expected history");
  const page = await history.list("");
  expect(page.entries.map((entry) => entry.agent.id)).toEqual(["h-home"]);
  expect(page.hostErrors).toEqual(["Build: offline"]);
});

it("history search skips hosts that cannot search and says why", async () => {
  const { multi } = setup();
  const history = multi.history;
  if (!history) throw Error("expected history");
  const page = await history.list("  fix ");
  expect(page.entries.map((entry) => entry.agent.id)).toEqual(["h-home"]);
  expect(page.truncated).toBe(true);
  expect(page.hostErrors).toEqual([
    "Build: search needs a newer daemon (agentHistorySearch)",
  ]);
  const blank = await history.list("   ");
  expect(blank.entries.map((entry) => entry.agent.id)).toEqual([
    "h-build",
    "h-home",
  ]);
  expect(blank.hostErrors).toEqual([]);
});

it("history unarchive rejects instead of throwing for an unknown agent", async () => {
  const { multi } = setup();
  const history = multi.history;
  if (!history) throw Error("expected history");
  let pending: Promise<void> | undefined;
  expect(() => {
    pending = history.unarchive("nobody");
  }).not.toThrow();
  await expect(pending).rejects.toThrow("host is not connected");
});

it("knows which agents run on another machine", () => {
  const { multi } = setup();
  multi.agents.getSnapshot();
  expect(multi.isRemoteAgent("a1")).toBe(false);
  expect(multi.isRemoteAgent("a2")).toBe(true);
  expect(multi.isRemoteAgent("unknown")).toBe(false);
});

function connection(initial: HostConnectionState) {
  const emitter = createEmitter();
  let state = initial;
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => state,
    set(next: HostConnectionState) {
      state = next;
      emitter.notify();
    },
  };
}
const DROPPED: HostConnectionState = {
  status: "disconnected",
  reason: "Transport closed",
  nextRetryAt: "2026-11-06T00:00:00Z",
};

it("keeps an offline host's workspaces, marks them offline and leaves its errors out", () => {
  const status = connection({ status: "connected" });
  const { multi, hosts } = setup({
    status,
    error: "DaemonConnectionError: Transport not connected",
  });
  expect(multi.directory.getSnapshot().error).toBe(
    "Build: DaemonConnectionError: Transport not connected",
  );
  status.set(DROPPED);
  hosts.set([...hosts.getSnapshot()]);
  const directory = multi.directory.getSnapshot();
  expect(directory.error).toBeNull();
  expect(multi.agents.getSnapshot().error).toBeNull();
  expect(directory.workspaces.map((w) => w.id)).toEqual(["w1", "w2"]);
  expect([...(directory.offline ?? [])]).toEqual(["w2"]);
  expect(multi.agents.getSnapshot().groups.map((g) => g.key)).toEqual([
    "w2",
    "w1",
  ]);
});

it("fails actions on an offline host fast and skips it in refreshes and history", async () => {
  const status = connection(DROPPED);
  const { multi, calls } = setup({ status });
  const w2 = multi.directory.getSnapshot().workspaces[1];
  if (!w2) throw Error("missing workspace");
  await expect(multi.management.archiveWorkspace(w2)).rejects.toThrow(
    "Build is offline",
  );
  await expect(multi.clearAttention("a2")).rejects.toThrow("Build is offline");
  multi.focus("w2");
  await expect(multi.management.directories("app")).rejects.toThrow(
    "Build is offline",
  );
  await multi.refresh();
  await multi.refreshProviders();
  expect(calls).toEqual(["home.refresh()", "home.refreshProviders()"]);
  const page = await multi.history?.list("");
  expect(page?.hostErrors).toEqual([]);
  expect(page?.entries.map((entry) => entry.agent.id)).toEqual(["h-home"]);
  multi.timelines.acquire(agent("a2"));
  expect(calls).toContain("build.openTimeline(a2)");
});

it("labels the window with the startup host, the other hosts and how many are offline", () => {
  const hosts = [
    {
      id: "home",
      label: "local",
      live: { connection: { label: "local (127.0.0.1:6767)" } },
    },
  ];
  expect(
    windowLabel(hosts, [
      {
        id: "home",
        label: "local",
        health: { kind: "connected" },
        version: "1",
      },
      {
        id: "b",
        label: "Build",
        health: {
          kind: "offline",
          since: 0,
          lastError: null,
          nextRetryAt: null,
        },
        version: null,
      },
      { id: "c", label: "GPU", health: { kind: "connected" }, version: "1" },
    ]),
  ).toBe("local (127.0.0.1:6767) +2 hosts · 1 offline");
});

function usageOf(snapshot: UsageSnapshot): UsageStore {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => {},
    close() {},
  };
}
function schedulesNamed(name: string): SchedulePort {
  const none = async () => {
    throw Error("Unexpected");
  };
  return {
    list: async () => [
      {
        id: name,
        name,
        status: "active",
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        cadence: { type: "every", everyMs: 60_000 },
        target: { type: "new-agent", config: { provider: "codex", cwd: "/" } },
        prompt: name,
        nextRunAt: null,
        lastRunAt: null,
        pausedAt: null,
        expiresAt: null,
        maxRuns: null,
      },
    ],
    inspect: none,
    logs: none,
    pause: none,
    resume: none,
    runOnce: none,
    remove: none,
    create: none,
  };
}

it("follows the startup host's current connection for status, usage and schedules", async () => {
  const calls: string[] = [];
  const directory = { projects: [], workspaces: [], terminals: [] };
  const oldStatus = connection({ status: "disconnected", reason: "auth" });
  const old = host("home", {
    agents: [],
    directory,
    calls,
    status: oldStatus,
    usage: usageOf({ kind: "loading" }),
    schedules: schedulesNamed("old"),
  });
  const emitter = createEmitter();
  let live = [old];
  const hosts = {
    subscribe: emitter.subscribe,
    getSnapshot: () => live,
    health: expected(["home"]),
  };
  const multi = createMultiHost(hosts);
  const { status, usage, schedules } = multi.startup;
  let changes = 0;
  status.subscribe(() => changes++);
  usage?.subscribe(() => {});
  expect(status.getSnapshot().status).toBe("disconnected");
  const ready: UsageSnapshot = { kind: "ready", reports: [] };
  live = [
    host("home", {
      agents: [],
      directory,
      calls,
      usage: usageOf(ready),
      schedules: schedulesNamed("new"),
    }),
  ];
  emitter.notify();
  expect(changes).toBeGreaterThan(0);
  expect(status.getSnapshot().status).toBe("connected");
  expect(usage?.getSnapshot()).toBe(ready);
  expect((await schedules.list()).map((schedule) => schedule.id)).toEqual([
    "new",
  ]);
});

it("sends project actions to an online host and fails fast when every owner is offline", async () => {
  const localStatus = connection(DROPPED);
  const { multi, calls } = setup({ status: connection(DROPPED), localStatus });
  const project = multi.directory.getSnapshot().projects[0];
  const [w1, w2] = multi.directory.getSnapshot().workspaces;
  if (!project || !w1 || !w2) throw Error("missing project");
  await expect(multi.management.baseBranches(project)).rejects.toThrow(
    "local is offline",
  );
  await expect(
    multi.management.removeProject(project, [w1, w2]),
  ).rejects.toThrow("local is offline");
  expect(calls).toEqual([]);
  localStatus.set({ status: "connected" });
  await expect(
    multi.management.removeProject(project, [w1, w2]),
  ).rejects.toThrow("Build is offline");
  expect(calls).toEqual(["home.removeProject(p1, w1)"]);
  localStatus.set(DROPPED);
  const offlineProject = project;
  await expect(
    multi.management.createWorkspace(
      offlineProject,
      {
        provider: "codex",
        model: "best",
        modeId: "ask",
        cwd: "/src",
        title: "Agent",
        prompt: "hi",
      },
      { kind: "local" },
    ),
  ).rejects.toThrow("local is offline");
});

it("sends a project shared by several hosts to an online one", async () => {
  const { multi } = setup({ localStatus: connection(DROPPED) });
  const project = multi.directory.getSnapshot().projects[0];
  if (!project) throw Error("missing project");
  await expect(multi.management.baseBranches(project)).rejects.toThrow(
    "Unexpected",
  );
});

it("sends each workspace's read state to its host, one request per host", async () => {
  const { multi, calls } = setup();
  multi.directory.getSnapshot();
  await multi.workspaceRead.markRead(["w2", "w1"]);
  await multi.workspaceRead.markUnread("w1");
  expect(calls).toEqual([
    "home.markRead(w1)",
    "build.markRead(w2)",
    "home.markUnread(w1)",
  ]);
});

it("offers mark-unread only for workspaces whose host supports it", async () => {
  const { multi } = setup();
  multi.directory.getSnapshot();
  expect(multi.workspaceRead.canMarkUnread("w1")).toBe(true);
  expect(multi.workspaceRead.canMarkUnread("w2")).toBe(false);
  await expect(multi.workspaceRead.markUnread("w2")).rejects.toThrow(
    "Build needs a newer daemon (workspaceMarkUnread)",
  );
});

it("marks the online hosts' workspaces read and reports the offline one", async () => {
  const { multi, calls } = setup({ status: connection(DROPPED) });
  multi.directory.getSnapshot();
  await expect(multi.workspaceRead.markRead(["w1", "w2"])).rejects.toThrow(
    "Build is offline",
  );
  expect(calls).toEqual(["home.markRead(w1)"]);
  await expect(multi.workspaceRead.markUnread("w2")).rejects.toThrow(
    "Build is offline",
  );
});

it("pins a workspace through its host, only where the host supports it, failing fast offline", async () => {
  const { multi, calls } = setup();
  multi.directory.getSnapshot();
  expect(multi.workspacePins.canPin("w1")).toBe(true);
  expect(multi.workspacePins.canPin("w2")).toBe(false);
  await multi.workspacePins.setPinned("w1", true);
  await multi.workspacePins.setPinned("w1", false);
  expect(calls).toEqual([
    "home.setPinned(w1, true)",
    "home.setPinned(w1, false)",
  ]);
  await expect(multi.workspacePins.setPinned("w2", true)).rejects.toThrow(
    "Build needs a newer daemon (workspacePinning)",
  );
  const offline = setup({ localStatus: connection(DROPPED) });
  offline.multi.directory.getSnapshot();
  await expect(
    offline.multi.workspacePins.setPinned("w1", true),
  ).rejects.toThrow("local is offline");
  expect(offline.calls).not.toContain("home.setPinned(w1, true)");
});

it("reads each workspace's labels from its host and assigns through it, failing fast offline", async () => {
  const assigned: string[] = [];
  const labels: LabelCatalog = {
    getSnapshot: () => ({
      kind: "ready",
      labels: [{ name: "Bug", color: "red" }],
      error: null,
    }),
    subscribe: () => () => {},
    load: async () => {},
    async setAssignment(input) {
      assigned.push(`${input.workspaceId}:${input.label.name}`);
      return [input.label.name];
    },
    async update(input) {
      assigned.push(`update ${input.name}`);
      return { name: input.newName ?? input.name, color: "red" };
    },
    async inspectDelete(name) {
      assigned.push(`inspect ${name}`);
      return 1;
    },
    async delete(name) {
      assigned.push(`delete ${name}`);
      return 1;
    },
    close: async () => {},
  };
  const status = connection({ status: "connected" });
  const { multi } = setup({ status, labels });
  multi.directory.getSnapshot();
  const view = multi.labels.getSnapshot();
  expect(view.host("w1")).toEqual({ kind: "unsupported" });
  expect(view.host("w2")).toEqual(labels.getSnapshot());
  expect(view.merged(null)).toEqual([{ name: "Bug", color: "red" }]);
  expect(view.authoritative).toBe(true);
  const bug = { name: "Bug", color: "red" } as const;
  await multi.labels.setAssignment({
    workspaceId: "w2",
    label: bug,
    assigned: true,
  });
  expect(assigned).toEqual(["w2:Bug"]);
  expect(view.catalogs).toEqual([
    {
      hostId: "build",
      label: "Build",
      online: true,
      labels: [{ name: "Bug", color: "red" }],
    },
  ]);
  await multi.labels.update("build", { name: "Bug", newName: "bug" });
  expect(await multi.labels.inspectDelete("build", "Bug")).toBe(1);
  await multi.labels.delete("build", "Bug");
  expect(assigned.slice(1)).toEqual([
    "update Bug",
    "inspect Bug",
    "delete Bug",
  ]);
  await expect(multi.labels.delete("home", "Bug")).rejects.toThrow(
    "Update the Paseo daemon on local",
  );
  await expect(
    multi.labels.setAssignment({
      workspaceId: "w1",
      label: bug,
      assigned: true,
    }),
  ).rejects.toThrow("Update the Paseo daemon on local");
  status.set(DROPPED);
  const offline = multi.labels.getSnapshot();
  expect(offline.host("w2")).toEqual(labels.getSnapshot());
  expect(offline.merged(null)).toEqual([{ name: "Bug", color: "red" }]);
  expect(offline.authoritative).toBe(false);
  await expect(
    multi.labels.setAssignment({
      workspaceId: "w2",
      label: bug,
      assigned: false,
    }),
  ).rejects.toThrow("Build is offline");
  expect(offline.catalogs[0]?.online).toBe(false);
  await expect(
    multi.labels.update("build", { name: "Bug", color: "sky" }),
  ).rejects.toThrow("Build is offline");
});

function listed(labels: readonly WorkspaceLabelDefinition[]): LabelCatalog {
  const snapshot: LabelCatalogSnapshot = { kind: "ready", labels, error: null };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    load: async () => {},
    setAssignment: unexpected,
    update: unexpected,
    inspectDelete: unexpected,
    delete: unexpected,
    close: async () => {},
  };
}

it("keeps the label view non-authoritative until every configured host has listed", () => {
  const calls: string[] = [];
  const directory = { projects: [], workspaces: [], terminals: [] };
  const local = host("home", {
    agents: [],
    directory,
    calls,
    labels: listed([{ name: "Bug", color: "red" }]),
  });
  const build = host("build", {
    agents: [],
    directory,
    calls,
    labels: listed([{ name: "UI", color: "sky" }]),
  });
  const emitter = createEmitter();
  let live = [local];
  const multi = createMultiHost({
    subscribe: emitter.subscribe,
    getSnapshot: () => live,
    health: expected(["home", "build"]),
  });
  expect(multi.labels.getSnapshot().authoritative).toBe(false);
  live = [local, build];
  emitter.notify();
  expect(multi.labels.getSnapshot().authoritative).toBe(true);
});
