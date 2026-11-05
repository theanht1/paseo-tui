import { expect, it } from "vitest";
import { agent } from "../test/fixtures.js";
import type { CommandStep } from "./command-center/registry.js";
import { createManagementController } from "./management-controller.js";

function submit(step: CommandStep, text: string) {
  if (step.kind !== "input") throw Error("Expected input");
  step.submit(text);
}
it("prefills rename, runs the operation, refreshes data and exposes failures", async () => {
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    name: "Old",
  };
  const names: string[] = [];
  let refreshes = 0;
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [],
    workspace,
    tab: null,
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
      openFile: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async (_, title) => {
        names.push(title);
      },
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async () => {},
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
    },
    refresh: async () => {
      refreshes++;
    },
    opened() {},
  }));
  controller.renameWorkspace(workspace);
  const state = controller.getSnapshot();
  if (state.overlay.kind !== "wizard") throw Error("Expected wizard");
  expect(state.overlay.step).toMatchObject({ kind: "input", initial: "Old" });
  submit(state.overlay.step, "New");
  await controller.settled();
  expect(names).toEqual(["New"]);
  expect(refreshes).toBe(1);
  expect(controller.getSnapshot().overlay.kind).toBe("closed");
});
it("offers project selection, preselected project configuration, and workspace tab kinds", () => {
  const project = {
    projectId: "p",
    projectDisplayName: "Repo",
    projectRootPath: "/repo",
    projectKind: "git" as const,
  };
  const controller = createManagementController(() => ({
    projects: [project],
    agents: [],
    workspaces: [],
    workspace: {
      id: "w",
      projectId: "p",
      projectRootPath: "/repo",
      workspaceDirectory: "/repo",
      name: "Main",
    },
    tab: null,
    catalog: null,
    actions: undefined,
    refresh: async () => {},
    opened() {},
  }));
  controller.createWorkspace();
  expect(controller.getSnapshot().overlay).toMatchObject({
    kind: "wizard",
    step: { title: "Project" },
  });
  controller.createWorkspace(project);
  expect(controller.getSnapshot().overlay).toMatchObject({
    kind: "wizard",
    step: { title: "Workspace" },
  });
  controller.createTab();
  expect(controller.getSnapshot().overlay).toMatchObject({
    kind: "wizard",
    step: { title: "Tab type" },
  });
});
it("reports capability errors after a mutation and does not refresh or fabricate success", async () => {
  let refreshed = false;
  let opened = false;
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    name: "Main",
  };
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [],
    workspace,
    tab: null,
    catalog: null,
    actions: undefined,
    refresh: async () => {
      refreshed = true;
    },
    opened() {
      opened = true;
    },
  }));
  controller.renameWorkspace(workspace);
  const { overlay } = controller.getSnapshot();
  if (overlay.kind !== "wizard") throw Error("Missing wizard");
  submit(overlay.step, "Title");
  await controller.settled();
  expect(controller.getSnapshot().operation).toMatchObject({
    kind: "error",
    message: expect.stringContaining("Update"),
  });
  expect(refreshed).toBe(false);
  expect(opened).toBe(false);
});

it("requires confirmation for the captured tab, cancels safely and reports failed closes", async () => {
  const first = { kind: "agent" as const, key: "agent:a", agent: agent("a") };
  const second = { kind: "agent" as const, key: "agent:b", agent: agent("b") };
  let tab = first;
  const events: string[] = [];
  let denied = false;
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [],
    workspace: null,
    tab,
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
      openFile: async () => {
        throw Error("Unexpected");
      },
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async () => {},
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async (target) => {
        if (denied) throw Error("Close denied");
        events.push(`close:${target.key}`);
      },
    },
    refresh: async () => {
      events.push("refresh");
    },
    opened() {},
    closed(target) {
      events.push(`closed:${target.key}`);
    },
  }));
  controller.closeTab();
  expect(controller.getSnapshot().overlay).toEqual({
    kind: "confirm-close",
    tab: first,
  });
  expect(events).toEqual([]);
  controller.close();
  controller.confirmCloseTab();
  await controller.settled();
  expect(events).toEqual([]);
  controller.closeTab();
  tab = second;
  controller.confirmCloseTab();
  controller.confirmCloseTab();
  await controller.settled();
  expect(events).toEqual(["close:agent:a", "closed:agent:a", "refresh"]);
  denied = true;
  controller.closeTab(second);
  controller.confirmCloseTab();
  await controller.settled();
  expect(controller.getSnapshot().operation).toEqual({
    kind: "error",
    message: "Close denied",
  });
  expect(events).toEqual(["close:agent:a", "closed:agent:a", "refresh"]);
});

it("confirms workspace archive before mutation and refreshes after success", async () => {
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    name: "Main",
  };
  const calls: string[] = [];
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [],
    workspace,
    tab: null,
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
      openFile: async () => {
        throw Error("Unexpected");
      },
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async () => {},
      renameTab: async () => {},
      closeTab: async () => {},
      archiveWorkspace: async (target) => {
        calls.push(target.id);
      },
    },
    refresh: async () => {
      calls.push("refresh");
    },
    opened() {},
    archived(target) {
      calls.push(`archived:${target.id}`);
    },
  }));
  controller.archiveWorkspace(workspace);
  expect(calls).toEqual([]);
  expect(controller.getSnapshot().overlay).toEqual({
    kind: "confirm-archive",
    workspace,
  });
  controller.close();
  expect(controller.getSnapshot().overlay).toEqual({ kind: "closed" });
  controller.confirmArchiveWorkspace();
  expect(calls).toEqual([]);
  controller.archiveWorkspace(workspace);
  controller.confirmArchiveWorkspace();
  await controller.settled();
  expect(calls).toEqual(["w", "archived:w", "refresh"]);
});
it("creates a new agent tab immediately from the current tab's config and keeps terminals reachable", async () => {
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/trees/w",
    name: "W",
  };
  const current = agent("current", {
    workspaceId: "w",
    model: "gpt",
    currentModeId: "auto",
  });
  const created: unknown[] = [];
  const opened: unknown[] = [];
  let terminals = 0;
  const controller = createManagementController(() => ({
    projects: [],
    agents: [current],
    workspaces: [],
    workspace,
    tab: { kind: "agent", key: "agent:current", agent: current },
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
      openFile: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async () => {},
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async () => {},
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async (target, input) => {
        created.push({ target: target.id, input });
        return agent("second", { workspaceId: "w" });
      },
      createTerminal: async () => {
        terminals++;
        return { id: "t", name: "Shell", workspaceId: "w", cwd: "/trees/w" };
      },
    },
    refresh: async () => {},
    opened(result) {
      opened.push(result.tab?.key);
    },
  }));
  controller.createTab();
  expect(controller.getSnapshot().overlay.kind).toBe("closed");
  await controller.settled();
  expect(created).toEqual([
    {
      target: "w",
      input: {
        provider: "codex",
        model: "gpt",
        modeId: "auto",
        cwd: "/trees/w",
        title: null,
        prompt: null,
      },
    },
  ]);
  expect(opened).toEqual(["agent:second"]);
  controller.createTerminalTab();
  await controller.settled();
  expect(terminals).toBe(1);
  expect(opened).toEqual(["agent:second", "terminal:t"]);
});

async function walk(step: CommandStep, picks: readonly string[]) {
  let current: CommandStep | undefined = step;
  for (const pick of picks) {
    if (!current) throw Error(`No step left for ${pick}`);
    if (current.kind === "choice") {
      const items = await current.items();
      const item = items.find((entry) => entry.title === pick);
      if (!item)
        throw Error(
          `Missing ${pick} in ${current.title}: ${items.map((i) => i.title).join(", ")}`,
        );
      current = item.run();
    } else if (current.kind === "input") current = current.submit(pick);
    else throw Error("Unexpected confirm");
  }
  return current;
}
function placementSetup() {
  const project = {
    projectId: "p",
    projectDisplayName: "Repo",
    projectRootPath: "/repo",
    projectKind: "git" as const,
  };
  const main = {
    id: "main",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo",
    name: "main",
  };
  const calls: unknown[] = [];
  const opened: unknown[] = [];
  const controller = createManagementController(() => ({
    projects: [project],
    agents: [],
    workspaces: [
      {
        id: "tree",
        projectId: "p",
        projectRootPath: "/repo",
        workspaceDirectory: "/trees/x",
        name: "x",
      },
      main,
    ],
    workspace: null,
    tab: null,
    catalog: {
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
    },
    actions: {
      baseBranches: async () => ({
        branches: ["master", "dev"],
        defaultBranch: "master",
      }),
      openFile: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async () => {},
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async () => {},
      createWorkspace: async (target, input, placement) => {
        calls.push({
          kind: "workspace",
          project: target.projectId,
          input,
          placement,
        });
        return {
          workspace: { ...main, id: "new", workspaceDirectory: "/trees/new" },
          agent: agent("first", { workspaceId: "new" }),
        };
      },
      createAgent: async (target, input) => {
        calls.push({ kind: "agent", workspace: target.id, input });
        return agent("local", { workspaceId: target.id });
      },
      createTerminal: async () => {
        throw Error("Unexpected");
      },
    },
    refresh: async () => {},
    opened(result) {
      opened.push([result.workspace?.id, result.tab?.key]);
    },
  }));
  function start() {
    controller.createWorkspace(project);
    const state = controller.getSnapshot();
    if (state.overlay.kind !== "wizard") throw Error("Expected wizard");
    return state.overlay.step;
  }
  return { controller, start, calls, opened };
}
it("asks Local or Worktree; Local creates the agent in the project's main checkout", async () => {
  const { controller, start, calls, opened } = placementSetup();
  const step = start();
  expect(step).toMatchObject({ kind: "choice", title: "Workspace" });
  if (step.kind !== "choice") throw Error("Expected choice");
  expect((await step.items()).map((item) => item.title)).toEqual([
    "Local",
    "Worktree",
  ]);
  await walk(step, ["Local", "Codex", "Best", "Provider default", "", "go"]);
  await controller.settled();
  expect(calls).toEqual([
    {
      kind: "agent",
      workspace: "main",
      input: {
        provider: "codex",
        model: "best",
        modeId: null,
        cwd: "/repo",
        title: null,
        prompt: "go",
      },
    },
  ]);
  expect(opened).toEqual([["main", "agent:local"]]);
});
it("creates a Worktree from the default base branch first, or a picked branch with a name", async () => {
  const { controller, start, calls } = placementSetup();
  const worktree = await walk(start(), ["Worktree"]);
  expect(worktree).toMatchObject({ kind: "choice", title: "Base branch" });
  if (worktree?.kind !== "choice") throw Error("Expected branches");
  const branches = await worktree.items();
  expect(branches.map((item) => [item.title, item.subtitle])).toEqual([
    ["master", "default"],
    ["dev", ""],
  ]);
  await walk(worktree, [
    "master",
    "",
    "Codex",
    "Best",
    "Provider default",
    "",
    "",
  ]);
  await controller.settled();
  await walk(start(), [
    "Worktree",
    "dev",
    "feature/x",
    "Codex",
    "Best",
    "Provider default",
    "",
    "",
  ]);
  await controller.settled();
  expect(calls).toMatchObject([
    {
      kind: "workspace",
      project: "p",
      placement: { kind: "worktree", baseBranch: "master", branchName: null },
      input: { cwd: "/repo" },
    },
    {
      kind: "workspace",
      placement: {
        kind: "worktree",
        baseBranch: "dev",
        branchName: "feature/x",
      },
    },
  ]);
});

it("opens a file in an editor terminal of the given workspace and asks for terminal input", async () => {
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/trees/w",
    name: "W",
  };
  const requests: unknown[] = [];
  const opened: unknown[] = [];
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [workspace],
    workspace: null,
    tab: null,
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      renameWorkspace: async () => {},
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async () => {},
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      openFile: async (target, editor) => {
        requests.push({ target: target.id, editor });
        return {
          id: "vim",
          name: editor.name,
          workspaceId: target.id,
          cwd: "/trees/w",
        };
      },
    },
    refresh: async () => {},
    opened(result) {
      opened.push({ key: result.tab?.key, input: result.input });
    },
  }));
  controller.openFile(workspace, { path: "/trees/w/a.ts", line: 4, col: null });
  await controller.settled();
  expect(requests).toEqual([
    {
      target: "w",
      editor: {
        name: "a.ts",
        command: "vim",
        args: ["+4", "--", "/trees/w/a.ts"],
      },
    },
  ]);
  expect(opened).toEqual([{ key: "terminal:vim", input: true }]);
});

it("opens the diff tool in the workspace once and refocuses its open tab", async () => {
  const workspace = {
    id: "w",
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: "/trees/w",
    name: "W",
  };
  const requests: unknown[] = [];
  const opened: unknown[] = [];
  const controller = createManagementController(() => ({
    projects: [],
    agents: [],
    workspaces: [workspace],
    workspace,
    tab: null,
    catalog: null,
    actions: {
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      renameWorkspace: async () => {},
      renameTab: async () => {},
      archiveWorkspace: async () => {},
      closeTab: async () => {},
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      openFile: async (target, tool) => {
        requests.push({ target: target.id, tool });
        return { id: "lg", name: tool.name, workspaceId: target.id, cwd: "/" };
      },
    },
    refresh: async () => {},
    opened(result) {
      opened.push({ key: result.tab?.key, input: result.input });
    },
  }));
  controller.openDiffTool("lazygit", [
    { id: "elsewhere", name: "lazygit", workspaceId: "x", cwd: "/x" },
  ]);
  await controller.settled();
  expect(requests).toEqual([
    {
      target: "w",
      tool: { name: "lazygit", command: "sh", args: ["-c", "lazygit"] },
    },
  ]);
  controller.openDiffTool("lazygit", [
    { id: "lg", name: "lazygit", workspaceId: "w", cwd: "/trees/w" },
  ]);
  await controller.settled();
  expect(requests).toHaveLength(1);
  expect(opened).toEqual([
    { key: "terminal:lg", input: true },
    { key: "terminal:lg", input: true },
  ]);
});
