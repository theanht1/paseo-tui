import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import type { CheckoutPort } from "../../connection/ports.js";
import type { CreateAgentInput } from "../../state/ports.js";
import { agent } from "../../test/fixtures.js";
import {
  type TransferDeps,
  type TransferRequest,
  transferWorkspace,
  type WorktreeSpec,
} from "./workspace-transfer.js";
import type { WorkspaceRow } from "./workspaces.js";

const MAIN = "/repo";
const NEW = "/worktrees/new";
const OTHER = "/worktrees/other";

/** A repository's checkouts, with git's rule that a branch lives in one checkout. */
class FakeGit implements CheckoutPort {
  branches = new Map<string, string>([[MAIN, "feat"]]);
  changes = new Map<string, string>();
  stashes = new Map<string, string>();
  pushed: string[] = [];
  failUnstash = false;
  held(branch: string) {
    return [...this.branches.values()].includes(branch);
  }
  async status(cwd: string) {
    return {
      branch: this.branches.get(cwd) ?? null,
      dirty: this.changes.has(cwd),
      baseRef: "origin/main",
    };
  }
  async switchBranch(cwd: string, branch: string) {
    if (this.held(branch)) throw Error(`${branch} is already used by worktree`);
    this.branches.set(cwd, branch);
  }
  async renameBranch(cwd: string, branch: string) {
    this.branches.set(cwd, branch);
  }
  async stash(cwd: string, label: string) {
    this.stashes.set(label, this.changes.get(cwd) ?? "");
    this.changes.delete(cwd);
  }
  async unstash(cwd: string, label: string) {
    if (this.failUnstash) throw Error("conflict");
    this.changes.set(cwd, this.stashes.get(label) ?? "");
    this.stashes.delete(label);
  }
  async push(cwd: string) {
    this.pushed.push(this.branches.get(cwd) ?? "");
  }
}
function row(id: string, directory: string): WorkspaceRow {
  return { id, workspaceDirectory: directory } as WorkspaceRow;
}
const project = { projectId: "p" } as PaseoProject;
const source = row("source", MAIN);
const alpha = agent("alpha", { title: "Alpha", cwd: MAIN, model: "opus" });

function setup(git = new FakeGit(), targetGit: FakeGit = git) {
  const created: { workspace: WorkspaceRow; input: CreateAgentInput }[] = [];
  const progress: string[] = [];
  const specs: WorktreeSpec[] = [];
  const failing = {
    worktree: false,
    fork: new Set<string>(),
  };
  const deps: TransferDeps = {
    sourceGit: git,
    targetGit,
    unique: () => "x1",
    async createWorktree(_, spec) {
      if (failing.worktree) throw Error("no room");
      specs.push(spec);
      if (spec.kind === "checkout") {
        if (targetGit.held(spec.branch)) throw Error("already checked out");
        targetGit.branches.set(NEW, spec.branch);
      } else targetGit.branches.set(NEW, spec.branch ?? "auto");
      return row("new", NEW);
    },
    async forkChat(chat) {
      if (failing.fork.has(chat.id)) throw Error("no history");
      return { type: "text", mimeType: "text/plain", text: `chat ${chat.id}` };
    },
    async createAgent(workspace, input) {
      created.push({ workspace, input });
      return agent(`new-${created.length}`, { cwd: input.cwd });
    },
    progress: (message) => progress.push(message),
  };
  function run(overrides: Partial<TransferRequest> = {}) {
    return transferWorkspace(
      {
        source,
        destination: { kind: "new-worktree", project, branchName: null },
        agents: [alpha],
        workspaceAgents: [alpha],
        ...overrides,
      },
      deps,
    );
  }
  return { git, targetGit, created, progress, specs, failing, run };
}

describe("transferring to a new worktree", () => {
  it("puts the branch and its uncommitted work in the worktree and frees the original", async () => {
    const { git, run } = setup();
    git.changes.set(MAIN, "edits");
    const result = await run();
    expect(result.workspace.workspaceDirectory).toBe(NEW);
    expect(git.branches.get(MAIN)).toBe("main");
    expect(git.branches.get(NEW)).toBe("feat");
    expect(git.changes.get(NEW)).toBe("edits");
    expect(git.changes.has(MAIN)).toBe(false);
    expect(result.notices).toEqual([]);
  });
  it("parks the original on a temporary branch and says so when main is elsewhere", async () => {
    const { git, specs, run } = setup();
    git.branches.set(OTHER, "main");
    const result = await run();
    const temporary = git.branches.get(MAIN);
    expect(temporary).toMatch(/^paseo-transfer-feat-x1$/);
    expect(specs).toEqual([
      { kind: "branch-off", base: temporary, branch: "feat" },
    ]);
    expect(git.branches.get(NEW)).toBe("feat");
    expect(result.notices.join()).toContain(`${temporary}`);
    expect(result.notices.join()).toContain("main");
  });
  it("branches off main when there is no working branch to move", async () => {
    const { git, specs, run } = setup();
    git.branches.set(MAIN, "main");
    git.changes.set(MAIN, "edits");
    await run({
      destination: { kind: "new-worktree", project, branchName: "fresh" },
    });
    expect(specs).toEqual([
      { kind: "branch-off", base: "main", branch: "fresh" },
    ]);
    expect(git.branches.get(MAIN)).toBe("main");
    expect(git.changes.get(NEW)).toBe("edits");
  });
  it("restores the original checkout when the worktree can't be made", async () => {
    const { git, failing, created, run } = setup();
    git.changes.set(MAIN, "edits");
    failing.worktree = true;
    await expect(run()).rejects.toThrow("no room");
    expect(git.branches.get(MAIN)).toBe("feat");
    expect(git.changes.get(MAIN)).toBe("edits");
    expect(created).toEqual([]);
  });
  it("undoes the temporary branch when the worktree can't be made", async () => {
    const { git, failing, run } = setup();
    git.branches.set(OTHER, "main");
    failing.worktree = true;
    await expect(run()).rejects.toThrow("no room");
    expect(git.branches.get(MAIN)).toBe("feat");
  });
  it("keeps the worktree and names the stash when the changes won't apply", async () => {
    const { git, run } = setup();
    git.changes.set(MAIN, "edits");
    git.failUnstash = true;
    const result = await run();
    expect(result.workspace.workspaceDirectory).toBe(NEW);
    expect(git.stashes.get("paseo-transfer-x1")).toBe("edits");
    expect(result.notices.join()).toContain("paseo-transfer-x1");
  });
  it("refuses while an agent in the workspace is running, changing nothing", async () => {
    const { git, run } = setup();
    const busy = agent("beta", { cwd: MAIN, status: "running" });
    await expect(run({ workspaceAgents: [alpha, busy] })).rejects.toThrow(
      /running/,
    );
    expect(git.branches.get(MAIN)).toBe("feat");
  });
});

describe("transferring to an existing checkout", () => {
  const destination = {
    kind: "existing",
    workspace: row("other", OTHER),
  } as const;
  it("checks the branch out there and moves the changes", async () => {
    const { git, run } = setup();
    git.branches.set(OTHER, "old");
    git.changes.set(MAIN, "edits");
    await run({ destination });
    expect(git.branches.get(OTHER)).toBe("feat");
    expect(git.branches.get(MAIN)).toBe("main");
    expect(git.changes.get(OTHER)).toBe("edits");
  });
  it("refuses a destination with its own uncommitted changes", async () => {
    const { git, run } = setup();
    git.branches.set(OTHER, "old");
    git.changes.set(OTHER, "theirs");
    git.changes.set(MAIN, "edits");
    await expect(run({ destination })).rejects.toThrow(/uncommitted/);
    expect(git.changes.get(MAIN)).toBe("edits");
    expect(git.branches.get(MAIN)).toBe("feat");
  });
  it("stops and restores when main is in use, pointing at a new worktree", async () => {
    const { git, run } = setup();
    git.branches.set(OTHER, "main");
    git.changes.set(MAIN, "edits");
    await expect(run({ destination })).rejects.toThrow(/new worktree/i);
    expect(git.branches.get(MAIN)).toBe("feat");
    expect(git.changes.get(MAIN)).toBe("edits");
  });
});

describe("transferring to another host", () => {
  const destination = { kind: "other-host-worktree", project } as const;
  it("pushes the branch and checks it out there, leaving the original on its branch", async () => {
    const remote = new FakeGit();
    remote.branches.clear();
    const { git, targetGit, specs, run } = setup(new FakeGit(), remote);
    await run({ destination });
    expect(git.pushed).toEqual(["feat"]);
    expect(specs).toEqual([{ kind: "checkout", branch: "feat" }]);
    expect(targetGit.branches.get(NEW)).toBe("feat");
    expect(git.branches.get(MAIN)).toBe("feat");
  });
  it("refuses uncommitted changes, which can't cross hosts", async () => {
    const { git, run } = setup();
    git.changes.set(MAIN, "edits");
    await expect(run({ destination })).rejects.toThrow(/commit/i);
    expect(git.pushed).toEqual([]);
  });
  it("refuses main itself", async () => {
    const { git, run } = setup();
    git.branches.set(MAIN, "main");
    await expect(run({ destination })).rejects.toThrow(/branch/i);
  });
});

describe("progress", () => {
  it("reports each step of a transfer", async () => {
    const { git, progress, run } = setup();
    git.changes.set(MAIN, "edits");
    await run();
    expect(progress).toEqual([
      "Creating worktree…",
      "Moving your changes…",
      "Moving Alpha…",
    ]);
  });
});

describe("moving agents", () => {
  it("recreates each agent with its settings and chat", async () => {
    const { created, run } = setup();
    const result = await run();
    expect(created).toHaveLength(1);
    expect(created[0]?.workspace.id).toBe("new");
    expect(created[0]?.input).toMatchObject({
      provider: alpha.provider,
      model: "opus",
      cwd: NEW,
      title: "Alpha",
      attachments: [{ text: "chat alpha" }],
    });
    expect(created[0]?.input.prompt).toContain(MAIN);
    expect(result.agents.map((moved: PaseoAgent) => moved.cwd)).toEqual([NEW]);
  });
  it("leaves an agent behind and says so when its chat can't be moved", async () => {
    const beta = agent("beta", { title: "Beta", cwd: MAIN, model: "opus" });
    const { failing, created, run } = setup();
    failing.fork.add("alpha");
    const result = await run({
      agents: [alpha, beta],
      workspaceAgents: [alpha, beta],
    });
    expect(created).toHaveLength(1);
    expect(result.notices.join()).toContain("Alpha");
  });
});
