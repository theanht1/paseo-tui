import type { PaseoProject } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { CreateAgentInput } from "../state/ports.js";
import { agent } from "../test/fixtures.js";
import type { CommandStep } from "./command-center/registry.js";
import type { HostOption, HostScope, HostsPort } from "./hosts/hosts.js";
import {
  createManagementController,
  type ManagementContext,
} from "./management-controller.js";
import type {
  WorkspaceActions,
  WorkspacePlacement,
} from "./workspace/workspace-actions.js";
import type { WorkspaceRow } from "./workspace/workspaces.js";

function project(id: string, root: string, kind: PaseoProject["projectKind"]) {
  return {
    projectId: id,
    projectDisplayName: id,
    projectRootPath: root,
    projectKind: kind,
  };
}
function row(id: string, projectId: string): WorkspaceRow {
  return {
    id,
    projectId,
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    name: id,
  };
}
type Call =
  | {
      kind: "workspace";
      host: string;
      project: string;
      input: CreateAgentInput;
      placement: WorkspacePlacement;
    }
  | { kind: "add"; host: string; cwd: string }
  | { kind: "remove"; host: string; project: string; workspaces: string[] }
  | { kind: "directories"; host: string; query: string };
function actions(host: string, calls: Call[]): WorkspaceActions {
  return {
    directories: async (query) => {
      calls.push({ kind: "directories", host, query });
      return [`/${host}/app`, `/${host}/api`];
    },
    addProject: async (cwd) => {
      calls.push({ kind: "add", host, cwd });
      return project("added", cwd, "git");
    },
    removeProject: async (target, workspaces) => {
      calls.push({
        kind: "remove",
        host,
        project: target.projectId,
        workspaces: workspaces.map((workspace) => workspace.id),
      });
    },
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    createWorkspace: async (target, input, placement) => {
      calls.push({
        kind: "workspace",
        host,
        project: target.projectId,
        input,
        placement,
      });
      return {
        workspace: row(`${host}-ws`, target.projectId),
        agent: agent(`${host}-agent`, { workspaceId: `${host}-ws` }),
      };
    },
    createAgent: async () => {
      throw Error("Unexpected");
    },
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    openFile: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    renameTab: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
  };
}
const catalog = {
  providers: async () => [
    {
      id: "codex",
      label: "Codex",
      available: true,
      error: null,
      defaultModeId: null,
    },
  ],
  models: async () => [
    { id: "best", label: "Best", description: null, isDefault: true },
  ],
  modes: async () => [],
};
class FakeHosts implements HostsPort {
  connects: string[] = [];
  added: unknown[] = [];
  scopes: string[] = [];
  hosts: HostOption[] = [
    {
      id: "home",
      label: "local",
      detail: "local (127.0.0.1:6767)",
      status: "connected",
    },
    {
      id: "build",
      label: "Build",
      detail: "build:6767",
      status: "connected",
    },
    {
      id: "gpu",
      label: "GPU",
      detail: "gpu:6767",
      status: "offline",
    },
  ];
  constructor(private calls: Call[]) {}
  list() {
    return this.hosts;
  }
  scope(id: string): HostScope {
    this.scopes.push(id);
    return {
      id,
      label: id === "home" ? "local" : "Build",
      projects: async () => [project("remote", "/srv/remote", "git")],
      actions: actions(id, this.calls),
      catalog,
    };
  }
  async add(input: {
    connection: string;
    label: string | null;
    password: string | null;
  }) {
    this.added.push(input);
    return {
      id: input.connection,
      label: input.label ?? input.connection,
      detail: input.connection,
      status: "connected" as const,
    };
  }
  async connect(id: string) {
    this.connects.push(id);
  }
}
function setup(overrides: Partial<ManagementContext> = {}) {
  const calls: Call[] = [];
  const hosts = new FakeHosts(calls);
  const opened: unknown[] = [];
  const notices: string[] = [];
  let refreshes = 0;
  const controller = createManagementController(() => ({
    projects: [
      project("app", "/repo/app", "git"),
      project("local", "/repo", "git"),
    ],
    placements: (id) =>
      id === "app"
        ? [
            { hostId: "home", project: project("p-home", "/home/app", "git") },
            {
              hostId: "build",
              project: project("p-build", "/srv/app", "git"),
            },
          ]
        : id === "local"
          ? [{ hostId: "home", project: project("local", "/repo", "git") }]
          : [],
    agents: [],
    workspaces: [row("a", "local"), row("b", "local")],
    workspace: null,
    tab: null,
    catalog,
    actions: actions("home", calls),
    refresh: async () => {
      refreshes++;
    },
    opened(result) {
      opened.push([result.workspace?.id, result.tab?.key]);
    },
    hosts,
    notify: (text) => notices.push(text),
    ...overrides,
  }));
  function wizard() {
    const state = controller.getSnapshot();
    if (state.overlay.kind !== "wizard") throw Error("Expected wizard");
    return state.overlay;
  }
  return {
    controller,
    calls,
    hosts,
    opened,
    notices,
    wizard,
    refreshes: () => refreshes,
  };
}
async function walk(step: CommandStep | undefined, picks: readonly string[]) {
  let current = step;
  for (const pick of picks) {
    if (!current) throw Error(`No step left for ${pick}`);
    if (current.kind === "choice" || current.kind === "search") {
      const items =
        current.kind === "choice"
          ? await current.items()
          : await current.search(pick.split("›")[0] ?? "");
      const title = pick.split("›").at(-1);
      const item = items.find((entry) => entry.title === title);
      if (!item)
        throw Error(
          `Missing ${pick} in ${current.title}: ${items.map((i) => i.title).join(", ")}`,
        );
      current = item.run();
    } else if (current.kind === "input") current = current.submit(pick);
    else {
      if (pick !== "y") throw Error(`Confirm ${current.title} with y`);
      current.confirm();
      current = undefined;
    }
  }
  return current;
}
const AGENT = ["Codex", "Best", "Provider default", "", "go"];

it("asks for the project first, then its host when the project is on several", async () => {
  const { controller, wizard, calls, hosts, opened, refreshes } = setup();
  controller.createWorkspace();
  const { title, step } = wizard();
  expect(title).toBe("New workspace");
  if (step.kind !== "choice") throw Error("Expected projects");
  expect((await step.items()).map((item) => item.title)).toEqual([
    "app",
    "local",
    "Add project…",
  ]);
  const host = await walk(step, ["app"]);
  if (host?.kind !== "choice") throw Error("Expected hosts");
  expect(host.title).toBe("Host");
  expect(
    (await host.items()).map((item) => [item.title, item.subtitle]),
  ).toEqual([
    ["local", "/home/app · connected"],
    ["Build", "/srv/app · connected"],
  ]);
  await walk(host, ["Build", "Worktree", "main", "feature/x", ...AGENT]);
  await controller.settled();
  expect(hosts.scopes).toEqual(["build"]);
  expect(calls).toMatchObject([
    {
      kind: "workspace",
      host: "build",
      project: "p-build",
      input: { cwd: "/srv/app", prompt: "go" },
      placement: {
        kind: "worktree",
        baseBranch: "main",
        branchName: "feature/x",
      },
    },
  ]);
  expect(refreshes()).toBe(1);
  expect(opened).toEqual([["build-ws", "agent:build-agent"]]);
  expect(controller.getSnapshot().operation).toEqual({ kind: "idle" });
});

it("skips the host step for a project on one host, and with a single host", async () => {
  const { controller, wizard, calls } = setup();
  controller.createWorkspace(project("local", "/repo", "git"));
  expect(wizard().step).toMatchObject({ kind: "choice", title: "Workspace" });
  await walk(wizard().step, ["Local", ...AGENT]);
  await controller.settled();
  expect(calls).toMatchObject([
    { kind: "workspace", host: "home", project: "local" },
  ]);
  const single = setup({ hosts: undefined, placements: undefined });
  single.controller.createWorkspace();
  await walk(single.wizard().step, ["app", "Local", ...AGENT]);
  await single.controller.settled();
  expect(single.calls).toMatchObject([
    { kind: "workspace", host: "home", project: "app" },
  ]);
});

it("creates a forked workspace with the seeded agent without asking for its configuration", async () => {
  const { controller, wizard, calls } = setup();
  const history = {
    type: "text" as const,
    mimeType: "text/plain" as const,
    contextKind: "chat_history",
    title: "Chat history",
    text: "earlier",
  };
  let started = 0;
  controller.createWorkspace(undefined, {
    provider: "codex",
    model: "best",
    modeId: "ask",
    thinkingOptionId: "high",
    title: "Fork of Alpha",
    start: async () => {
      started++;
      return { prompt: "carry on", attachments: [history] };
    },
  });
  expect(wizard().title).toBe("Fork to new workspace");
  const done = await walk(wizard().step, ["app", "Build", "Local"]);
  expect(done).toBeUndefined();
  await controller.settled();
  expect(started).toBe(1);
  expect(calls).toEqual([
    {
      kind: "workspace",
      host: "build",
      project: "p-build",
      placement: { kind: "local" },
      input: {
        provider: "codex",
        model: "best",
        modeId: "ask",
        thinkingOptionId: "high",
        cwd: "/srv/app",
        title: "Fork of Alpha",
        prompt: "carry on",
        attachments: [history],
      },
    },
  ]);
});

it("adds a project found by searching the host's directories, or a typed path", async () => {
  const { controller, wizard, calls, notices, refreshes } = setup({
    hosts: undefined,
  });
  controller.addProject();
  const step = wizard().step;
  expect(step).toMatchObject({ kind: "search", title: "Directory" });
  if (step.kind !== "search") throw Error("Expected search");
  expect((await step.search("app")).map((item) => item.title)).toEqual([
    "/home/app",
    "/home/api",
  ]);
  expect(
    (await step.search("~/code/new")).map((item) => [
      item.title,
      item.subtitle,
    ]),
  ).toEqual([
    ["~/code/new", "Use this path"],
    ["/home/app", undefined],
    ["/home/api", undefined],
  ]);
  await walk(step, ["app›/home/app"]);
  await controller.settled();
  expect(calls.filter((call) => call.kind === "add")).toEqual([
    { kind: "add", host: "home", cwd: "/home/app" },
  ]);
  expect(refreshes()).toBe(1);
  expect(notices).toEqual(["Added project added"]);
});

it("adds a project on the chosen host, offering only connected hosts", async () => {
  const { controller, wizard, calls, refreshes } = setup();
  controller.addProject();
  const step = wizard().step;
  if (step.kind !== "choice") throw Error("Expected hosts");
  expect((await step.items()).map((item) => item.title)).toEqual([
    "local",
    "Build",
  ]);
  await walk(step, ["Build", "app›/build/app"]);
  await controller.settled();
  expect(calls.filter((call) => call.kind === "add")).toEqual([
    { kind: "add", host: "build", cwd: "/build/app" },
  ]);
  expect(refreshes()).toBe(1);
});

it("lists the projects with workspace counts and removes one after confirming", async () => {
  const { controller, wizard, calls, notices } = setup();
  controller.listProjects();
  const step = wizard().step;
  if (step.kind !== "choice") throw Error("Expected projects");
  expect(
    (await step.items()).map((item) => [item.title, item.subtitle]),
  ).toEqual([
    ["app", "/repo/app · 0 workspaces"],
    ["local", "/repo · 2 workspaces"],
    ["Add project…", "Find a directory on the host"],
  ]);
  const confirm = await walk(step, ["local", "Remove project…"]);
  expect(confirm).toMatchObject({
    kind: "confirm",
    title:
      "Remove local? Archives its 2 workspaces and deletes their worktrees; the main checkout stays",
  });
  await walk(confirm, ["y"]);
  await controller.settled();
  expect(calls).toEqual([
    { kind: "remove", host: "home", project: "local", workspaces: ["a", "b"] },
  ]);
  expect(notices).toEqual(["Removed project local"]);
});

it("passes the typed password to the host, never in the operation message", async () => {
  const { controller, wizard, hosts } = setup();
  controller.addHost();
  await walk(wizard().step, ["build:6767", "Build", "s3cret"]);
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("s3cret");
  await controller.settled();
  expect(hosts.added).toEqual([
    { connection: "build:6767", label: "Build", password: "s3cret" },
  ]);
});
it("adds a host by address and optional name, and reconnects an offline one from the list", async () => {
  const { controller, wizard, hosts, notices } = setup();
  controller.addHost();
  const password = await walk(wizard().step, ["gpu:6767", ""]);
  expect(password).toMatchObject({
    kind: "input",
    title: "Password",
    secret: true,
  });
  await walk(password, [""]);
  await controller.settled();
  expect(hosts.added).toEqual([
    { connection: "gpu:6767", label: null, password: null },
  ]);
  expect(notices).toEqual(["Added host gpu:6767"]);
  controller.listHosts();
  const list = wizard().step;
  if (list.kind !== "choice") throw Error("Expected hosts");
  expect(
    (await list.items()).map((item) => [item.title, item.subtitle]),
  ).toEqual([
    ["local", "local (127.0.0.1:6767) · connected"],
    ["Build", "build:6767 · connected"],
    ["GPU", "gpu:6767 · offline · Enter to reconnect"],
    ["Add host…", "Connect to another Paseo daemon"],
  ]);
  await walk(list, ["Build"]);
  expect(hosts.connects).toEqual([]);
  controller.listHosts();
  await walk(wizard().step, ["GPU"]);
  await controller.settled();
  expect(hosts.connects).toEqual(["gpu"]);
});
