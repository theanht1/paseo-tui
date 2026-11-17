import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoProject } from "@getpaseo/client";
import { afterEach, describe, expect, inject, it } from "vitest";
import { connect } from "../../connection/connect.js";
import { createSession } from "../../session.js";
import {
  type TransferDestination,
  transferWorkspace,
} from "./workspace-transfer.js";
import type { WorkspaceRow } from "./workspaces.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function repository(branch: string | null) {
  const parent = mkdtempSync(join(tmpdir(), "paseo-tui-transfer-"));
  cleanups.push(() => rm(parent, { recursive: true, force: true }));
  const repo = join(parent, "repo");
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "tracked.txt"), "original\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "start");
  if (branch) git(repo, "switch", "-c", branch);
  writeFileSync(join(repo, "tracked.txt"), "edited\n");
  writeFileSync(join(repo, "untracked.txt"), "new\n");
  return { parent, repo };
}
async function session() {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  const created = createSession(connection);
  cleanups.push(async () => {
    await created.close();
    await connection.close();
  });
  return { connection, actions: created.management };
}
function row(repo: string, project: PaseoProject) {
  return {
    id: "source",
    projectId: project.projectId,
    workspaceDirectory: repo,
    projectRootPath: repo,
    name: "source",
  } as WorkspaceRow;
}
async function transfer(
  repo: string,
  destination: (project: PaseoProject) => TransferDestination,
) {
  const { connection, actions } = await session();
  if (!connection.projects.add) throw Error("Daemon lacks projectAdd");
  const project = await connection.projects.add(repo);
  const source = row(repo, project);
  const port = actions.checkout(source);
  return transferWorkspace(
    {
      source,
      destination: destination(project),
      agents: [],
      workspaceAgents: [],
      settings: null,
    },
    {
      sourceGit: port,
      targetGit: port,
      unique: () => Date.now().toString(36),
      createWorktree: (own, spec) => actions.createWorktree(own, spec),
      forkChat: (agent) => actions.forkChat(agent),
      createAgent: (workspace, input) => actions.createAgent(workspace, input),
      progress: () => {},
    },
  );
}
function expectChangesMoved(from: string, to: string) {
  expect(readFileSync(join(to, "tracked.txt"), "utf8")).toBe("edited\n");
  expect(readFileSync(join(to, "untracked.txt"), "utf8")).toBe("new\n");
  expect(readFileSync(join(from, "tracked.txt"), "utf8")).toBe("original\n");
  expect(existsSync(join(from, "untracked.txt"))).toBe(false);
}
const newWorktree = (project: PaseoProject): TransferDestination => ({
  kind: "new-worktree",
  project,
  branchName: null,
});

describe("workspace transfer on a real repository", () => {
  it("moves a feature branch and its changes to a new worktree", async () => {
    const { repo } = repository("feature/thing");
    const result = await transfer(repo, newWorktree);
    const tree = result.workspace.workspaceDirectory;
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(tree, "branch", "--show-current")).toBe("feature/thing");
    expectChangesMoved(repo, tree);
    expect(result.notices).toEqual([]);
  }, 60000);
  it("parks the original on a temporary branch when main is checked out elsewhere", async () => {
    const { parent, repo } = repository("feature/thing");
    git(repo, "worktree", "add", join(parent, "holder"), "main");
    const result = await transfer(repo, newWorktree);
    const tree = result.workspace.workspaceDirectory;
    const parked = git(repo, "branch", "--show-current");
    expect(parked).toMatch(/^paseo-transfer-feature-thing-/);
    expect(git(tree, "branch", "--show-current")).toBe("feature/thing");
    expectChangesMoved(repo, tree);
    expect(result.notices.join()).toContain(parked);
  }, 60000);
  it("recreates an agent with its chat in the worktree and keeps the original", async () => {
    const { repo } = repository("feature/agents");
    const { connection, actions } = await session();
    if (!connection.projects.add) throw Error("Daemon lacks projectAdd");
    const project = await connection.projects.add(repo);
    const { workspace, agent } = await actions.createWorkspace(
      project,
      {
        provider: "mock",
        model: "ten-second-stream",
        modeId: null,
        cwd: repo,
        title: "Mover",
        prompt: "remember the word pineapple",
      },
      { kind: "local" },
    );
    if (!agent) throw Error("No first agent");
    const handle = connection.api.agents.ref(agent.id);
    async function latest() {
      const found = await handle.refresh();
      if (!found) throw Error("The agent is gone");
      return found.agent;
    }
    await expect
      .poll(async () => (await latest()).status, { timeout: 40000 })
      .toBe("idle");
    const current = await latest();
    const port = actions.checkout(workspace);
    const result = await transferWorkspace(
      {
        source: workspace,
        destination: { kind: "new-worktree", project, branchName: null },
        agents: [current],
        workspaceAgents: [current],
        settings: null,
      },
      {
        sourceGit: port,
        targetGit: port,
        unique: () => Date.now().toString(36),
        createWorktree: (own, spec) => actions.createWorktree(own, spec),
        forkChat: (chat) => actions.forkChat(chat),
        createAgent: (target, input) => actions.createAgent(target, input),
        progress: () => {},
      },
    );
    expect(result.notices).toEqual([]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.cwd).toBe(result.workspace.workspaceDirectory);
    expect(result.agents[0]?.title).toBe("Mover");
    expect((await latest()).archivedAt).toBeFalsy();
  }, 90000);
  it("branches off main when the work was never on a branch", async () => {
    const { repo } = repository(null);
    const result = await transfer(repo, (project) => ({
      kind: "new-worktree",
      project,
      branchName: "from-main",
    }));
    const tree = result.workspace.workspaceDirectory;
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(tree, "branch", "--show-current")).toBe("from-main");
    expectChangesMoved(repo, tree);
  }, 60000);
});
