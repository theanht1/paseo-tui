import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import {
  createWorkspaceActions,
  type ManagementApi,
} from "./workspace-actions.js";

const project = {
  projectId: "p",
  projectDisplayName: "Project",
  projectRootPath: "/repo",
  projectKind: "git" as const,
};
const workspace = {
  id: "w",
  projectId: "p",
  projectRootPath: "/repo",
  workspaceDirectory: "/tree",
  name: "Worktree",
};
const input = {
  provider: "codex",
  model: "best",
  modeId: "ask",
  title: "Agent",
  prompt: "hello",
  cwd: "/repo",
};
it("creates a project worktree with the requested initial agent and creates tabs in the exact workspace", async () => {
  const calls: unknown[] = [];
  const api: ManagementApi = {
    createWorkspace: async (options) => {
      calls.push(options);
      return { workspace, agent: agent("a", { workspaceId: "w" }) };
    },
    createAgent: async (id, options) => {
      calls.push({ id, options });
      return agent("b", { workspaceId: id });
    },
    createTerminal: async (workspaceId) => ({
      id: "t",
      name: "Shell",
      cwd: "/tree",
      workspaceId,
    }),
    renameWorkspace: async (id, title) => {
      calls.push({ id, title });
    },
    archiveWorkspace: async () => {},
    archiveAgent: async () => {},
    killTerminal: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    branches: async () => ({ branches: [], baseRef: null }),
  };
  const actions = createWorkspaceActions(api, {
    create: true,
    thinking: true,
    workspace: true,
    terminal: true,
  });
  await actions.createWorkspace(
    project,
    { ...input, thinkingOptionId: "high" },
    { kind: "worktree", baseBranch: "master", branchName: null },
  );
  expect(calls[0]).toMatchObject({
    source: {
      kind: "worktree",
      projectId: "p",
      cwd: "/repo",
      action: "branch-off",
      baseBranch: "master",
    },
    agent: {
      config: {
        provider: "codex/best",
        modeId: "ask",
        thinkingOptionId: "high",
      },
      prompt: "hello",
      title: "Agent",
    },
  });
  expect(calls[0]).not.toHaveProperty("source.branchName");
  await actions.createWorkspace(project, input, {
    kind: "worktree",
    baseBranch: "main",
    branchName: "feature/x",
  });
  expect(calls.pop()).toMatchObject({
    source: { baseBranch: "main", branchName: "feature/x" },
  });
  await actions.createWorkspace(project, input, { kind: "local" });
  expect(calls.pop()).toMatchObject({
    source: { kind: "directory", path: "/repo", projectId: "p" },
  });
  await actions.createAgent(workspace, { ...input, thinkingOptionId: "high" });
  expect(calls[1]).toMatchObject({
    id: "w",
    options: {
      config: {
        provider: "codex/best",
        modeId: "ask",
        thinkingOptionId: "high",
      },
    },
  });
  await actions.renameWorkspace(workspace, " New name ");
  expect(calls[2]).toEqual({ id: "w", title: "New name" });
  expect((await actions.createTerminal(workspace)).workspaceId).toBe("w");
});
it("blocks unsupported operations before RPC and rejects blank names", async () => {
  let calls = 0;
  const api: ManagementApi = {
    createWorkspace: async () => {
      calls++;
      return { workspace, agent: null };
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      calls++;
      return { id: "t", name: "s", cwd: "/tree", workspaceId: "w" };
    },
    renameWorkspace: async () => {
      calls++;
    },
    archiveWorkspace: async () => {},
    archiveAgent: async () => {},
    killTerminal: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {
      calls++;
    },
    branches: async () => ({ branches: [], baseRef: null }),
  };
  const actions = createWorkspaceActions(api, {
    create: false,
    workspace: false,
    terminal: false,
  });
  await expect(
    actions.createWorkspace(project, input, { kind: "local" }),
  ).rejects.toThrow(/Update/);
  await expect(actions.createTerminal(workspace)).rejects.toThrow(/Update/);
  await expect(actions.renameWorkspace(workspace, "name")).rejects.toThrow(
    /Update/,
  );
  await expect(
    actions.renameTab(
      {
        kind: "terminal",
        key: "terminal:t",
        terminal: { id: "t", name: "s", cwd: "/tree", workspaceId: "w" },
      },
      "new",
    ),
  ).rejects.toThrow(/Update/);
  await expect(
    createWorkspaceActions(api, {
      create: true,
      workspace: true,
      terminal: true,
    }).renameWorkspace(workspace, " "),
  ).rejects.toThrow(/empty/);
  expect(calls).toBe(0);
});

it("archives agent tabs and kills terminal tabs, gating terminals before RPC", async () => {
  const calls: string[] = [];
  const api: ManagementApi = {
    branches: async () => ({ branches: [], baseRef: null }),
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    archiveWorkspace: async () => {},
    archiveAgent: async (id) => {
      calls.push(`archive:${id}`);
    },
    killTerminal: async (id) => {
      calls.push(`kill:${id}`);
    },
  };
  const actions = createWorkspaceActions(api, {
    create: true,
    workspace: true,
    terminal: true,
  });
  const terminal = {
    kind: "terminal" as const,
    key: "terminal:t",
    terminal: { id: "t", workspaceId: "w", cwd: "/repo", name: "Shell" },
  };
  await actions.closeTab({ kind: "agent", key: "agent:a", agent: agent("a") });
  await actions.closeTab(terminal);
  expect(calls).toEqual(["archive:a", "kill:t"]);
  const unsupported = createWorkspaceActions(api, {
    create: true,
    workspace: true,
    terminal: false,
  });
  await expect(unsupported.closeTab(terminal)).rejects.toThrow(/Update/);
  expect(calls).toEqual(["archive:a", "kill:t"]);
});

it("archives the exact workspace and blocks unsupported workspace archive before RPC", async () => {
  const calls: string[] = [];
  const api: ManagementApi = {
    branches: async () => ({ branches: [], baseRef: null }),
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    archiveAgent: async () => {},
    killTerminal: async () => {},
    archiveWorkspace: async (id) => {
      calls.push(id);
    },
  };
  await createWorkspaceActions(api, {
    create: true,
    workspace: true,
    terminal: true,
  }).archiveWorkspace(workspace);
  await expect(
    createWorkspaceActions(api, {
      create: true,
      workspace: false,
      terminal: true,
    }).archiveWorkspace(workspace),
  ).rejects.toThrow(/Update/);
  expect(calls).toEqual(["w"]);
});

it("lists base branches for the project root with the default first", async () => {
  const roots: string[] = [];
  const api: ManagementApi = {
    createWorkspace: async () => ({ workspace, agent: null }),
    createAgent: async () => agent("a"),
    createTerminal: async () => ({
      id: "t",
      name: "s",
      cwd: "/tree",
      workspaceId: "w",
    }),
    renameWorkspace: async () => {},
    archiveWorkspace: async () => {},
    archiveAgent: async () => {},
    killTerminal: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    branches: async (cwd) => {
      roots.push(cwd);
      return { branches: ["dev", "master", "feature"], baseRef: null };
    },
  };
  const actions = createWorkspaceActions(api, {
    create: true,
    workspace: true,
    terminal: true,
  });
  expect(await actions.baseBranches(project)).toEqual({
    branches: ["master", "dev", "feature"],
    defaultBranch: "master",
  });
  expect(roots).toEqual(["/repo"]);
});

it("opens a file by creating a named terminal in the workspace that runs the editor", async () => {
  const created: unknown[] = [];
  const api: ManagementApi = {
    createWorkspace: async () => ({ workspace, agent: null }),
    createAgent: async () => agent("a"),
    createTerminal: async (workspaceId, options) => {
      created.push({ workspaceId, options });
      return { id: "t", name: options?.name ?? "", cwd: "/tree", workspaceId };
    },
    renameWorkspace: async () => {},
    archiveWorkspace: async () => {},
    archiveAgent: async () => {},
    killTerminal: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    branches: async () => ({ branches: [], baseRef: null }),
  };
  const editor = {
    name: "a.ts",
    command: "vim",
    args: ["+3", "--", "/tree/a.ts"],
  };
  const terminal = await createWorkspaceActions(api, {
    create: true,
    workspace: true,
    terminal: true,
  }).openFile(workspace, editor);
  expect(terminal.name).toBe("a.ts");
  expect(created).toEqual([{ workspaceId: "w", options: editor }]);
  await expect(
    createWorkspaceActions(api, {
      create: true,
      workspace: true,
      terminal: false,
    }).openFile(workspace, editor),
  ).rejects.toThrow(/Update/);
});
