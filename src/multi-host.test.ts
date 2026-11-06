import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { LiveHost } from "./hosts.js";
import { createMultiHost, type HostSession } from "./multi-host.js";
import { createEmitter } from "./state/emitter.js";
import { agent, NO_PROJECT_ACTIONS, timelineStore } from "./test/fixtures.js";
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
    status: fixed({ status: "connected" }),
    agents: fixed({
      groups: options.agents.map((a) => ({
        key: a.workspaceId ?? a.cwd,
        agents: [a],
        updatedAt: a.updatedAt,
      })),
      error: null,
    }),
    directory: fixed({ ...options.directory, error: null }),
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
      create: unexpected,
    },
    clearAttention: record("clearAttention"),
    refresh: record("refresh"),
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
    schedules: {
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
function setup(options: { historyFails?: boolean } = {}) {
  const calls: string[] = [];
  const local = host("home", {
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
