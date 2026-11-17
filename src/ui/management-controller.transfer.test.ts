import type { PaseoProject } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import type { CheckoutPort } from "../connection/ports.js";
import { agent } from "../test/fixtures.js";
import type { CommandStep } from "./command-center/registry.js";
import { createManagementController } from "./management-controller.js";
import {
  createWorkspaceActions,
  type ManagementApi,
} from "./workspace/workspace-actions.js";
import type { WorkspaceRow } from "./workspace/workspaces.js";

const project = {
  projectId: "p",
  projectDisplayName: "Repo",
  projectRootPath: "/repo",
  projectKind: "git",
} as PaseoProject;
function row(id: string, directory: string) {
  return {
    id,
    projectId: "p",
    projectRootPath: "/repo",
    workspaceDirectory: directory,
    name: id,
  } as WorkspaceRow;
}
const source = row("main", "/repo");
const alpha = agent("alpha", {
  title: "Alpha",
  cwd: "/repo",
  workspaceId: "main",
  model: "opus",
});
const beta = agent("beta", {
  title: "Beta",
  cwd: "/repo",
  workspaceId: "main",
  model: "opus",
});

function setup(
  branch = "feat",
  mainHeld = false,
  worktreeReady: Promise<void> = Promise.resolve(),
) {
  const log: string[] = [];
  const sources: unknown[] = [];
  const opened: unknown[] = [];
  const notes: string[] = [];
  const created: string[] = [];
  const inputs: unknown[] = [];
  const checkout: CheckoutPort = {
    status: async () => ({ branch, dirty: false, baseRef: "origin/main" }),
    async switchBranch(cwd, name) {
      if (mainHeld && name === "main") throw Error("in use");
      log.push(`switch ${cwd} ${name}`);
    },
    renameBranch: async (cwd, name) => {
      log.push(`rename ${cwd} ${name}`);
    },
    stash: async () => {},
    unstash: async () => {},
    push: async () => {},
  };
  const api: ManagementApi = {
    async createWorkspace(options) {
      sources.push(options.source);
      await worktreeReady;
      return { workspace: row("tree", "/trees/x"), agent: null };
    },
    async createAgent(workspaceId, options) {
      created.push(`${workspaceId}:${options.title}`);
      inputs.push(options);
      return agent(`new-${options.title}`);
    },
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    renameAgent: async () => {},
    renameTerminal: async () => {},
    archiveAgent: async (id) => {
      log.push(`archive ${id}`);
    },
    archiveWorkspace: async () => {},
    killTerminal: async () => {},
    branches: async () => ({ branches: ["main"], baseRef: "main" }),
    projects: { add: null, remove: null, directories: async () => [] },
    checkout,
    forkContext: async (id) => ({
      type: "text",
      mimeType: "text/plain",
      text: `chat ${id}`,
    }),
  };
  const controller = createManagementController(() => ({
    projects: [project],
    agents: [alpha, beta],
    workspaces: [source, row("other", "/trees/other")],
    workspace: source,
    tab: { kind: "agent", key: "agent:alpha", agent: alpha },
    catalog: {
      providers: async () => [
        {
          id: "claude",
          label: "Claude",
          available: true,
          error: null,
          defaultModeId: null,
        },
      ],
      models: async () => [
        {
          id: "sonnet",
          label: "Sonnet",
          description: null,
          isDefault: true,
          thinking: {
            kind: "options",
            options: [{ id: "high", label: "High" }],
          },
        },
      ],
      modes: async () => [{ id: "auto", label: "Auto", description: null }],
      onProvidersChange: () => () => {},
    },
    actions: createWorkspaceActions(api, {
      create: true,
      thinking: true,
      workspace: true,
      terminal: true,
    }),
    refresh: async () => {},
    opened: (result) => opened.push(result),
    notify: (text) => notes.push(text),
  }));
  function step(): CommandStep {
    const { overlay } = controller.getSnapshot();
    if (overlay.kind !== "wizard") throw Error("Expected wizard");
    return overlay.step;
  }
  return { controller, step, log, sources, opened, notes, created, inputs };
}
async function titles(step: CommandStep) {
  if (step.kind !== "choice") throw Error("Expected choice");
  return (await step.items()).map((item) => item.title);
}
async function pick(step: CommandStep | undefined, id: string) {
  if (step?.kind !== "choice") throw Error("Expected choice");
  const item = (await step.items()).find((candidate) => candidate.id === id);
  if (!item) throw Error(`Missing ${id}`);
  return item.run();
}

describe("Transfer agents", () => {
  it("offers a new worktree and the project's other workspaces", async () => {
    const { controller, step } = setup();
    controller.transferWorkspace(source);
    expect(step()).toMatchObject({ title: "Transfer to" });
    expect(await titles(step())).toEqual([
      "This workspace",
      "New worktree",
      "other",
    ]);
  });
  it("asks whether to keep or change the provider and model, then which agents move", async () => {
    const { controller, step, log, sources, opened, created } = setup();
    controller.transferWorkspace(source);
    const settings = await pick(step(), "transfer:new-worktree");
    if (!settings) throw Error("Expected the provider step");
    expect(settings).toMatchObject({ title: "Provider & model" });
    expect(await titles(settings)).toEqual([
      "Keep each agent's own",
      "Change provider & model…",
    ]);
    const agents = await pick(settings, "transfer:keep");
    if (!agents) throw Error("Expected the agents step");
    expect(await titles(agents)).toEqual([
      "Transfer 1 agent",
      "[x] Alpha",
      "[ ] Beta",
    ]);
    const toggled = await pick(agents, "transfer:agent:beta");
    if (!toggled) throw Error("Expected the agents step");
    expect((await titles(toggled))[0]).toBe("Transfer 2 agents");
    await pick(toggled, "transfer:go");
    await controller.settled();
    expect(sources).toEqual([
      expect.objectContaining({
        kind: "worktree",
        action: "checkout",
        refName: "feat",
      }),
    ]);
    expect(log).toEqual(["switch /repo main"]);
    expect(created).toEqual(["tree:Alpha", "tree:Beta"]);
    expect(opened).toEqual([
      expect.objectContaining({
        workspace: expect.objectContaining({ id: "tree" }),
      }),
    ]);
    expect(controller.getSnapshot().operation.kind).toBe("idle");
  });
  it("transfers to this workspace on a new provider and model, leaving git alone", async () => {
    const { controller, step, log, sources, created, inputs } = setup();
    controller.transferWorkspace(source);
    const settings = await pick(step(), "transfer:current");
    let next = await pick(settings, "transfer:change");
    for (const id of [
      "provider:claude",
      "model:sonnet",
      "mode:auto",
      "thinking:high",
    ])
      next = await pick(next, id);
    if (next?.kind !== "choice") throw Error("Expected the agents step");
    const [go] = await next.items();
    expect(go).toMatchObject({
      title: "Transfer 1 agent",
      subtitle: "As claude · sonnet · high · originals stay where they are",
    });
    await pick(next, "transfer:go");
    await controller.settled();
    expect(sources).toEqual([]);
    expect(log).toEqual([]);
    expect(created).toEqual(["main:Alpha"]);
    expect(inputs).toEqual([
      expect.objectContaining({
        config: {
          provider: "claude/sonnet",
          modeId: "auto",
          thinkingOptionId: "high",
        },
      }),
    ]);
  });
  it("keeps each agent's own provider and model", async () => {
    const { controller, step, inputs } = setup();
    controller.transferWorkspace(source);
    const settings = await pick(step(), "transfer:current");
    await pick(await pick(settings, "transfer:keep"), "transfer:go");
    await controller.settled();
    expect(inputs).toEqual([
      expect.objectContaining({ config: { provider: "codex/opus" } }),
    ]);
  });
  it("asks for a branch name when the workspace is on the default branch", async () => {
    const { controller, step, sources } = setup("main");
    controller.transferWorkspace(source);
    const name = await pick(step(), "transfer:new-worktree");
    if (name?.kind !== "input") throw Error("Expected the branch name");
    const agents = await pick(name.submit("fresh"), "transfer:keep");
    await pick(agents, "transfer:go");
    await controller.settled();
    expect(sources).toEqual([
      expect.objectContaining({
        action: "branch-off",
        baseBranch: "main",
        branchName: "fresh",
      }),
    ]);
  });
  it("shows the step under way while the worktree is being created", async () => {
    let finish = () => {};
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { controller, step } = setup("feat", false, ready);
    controller.transferWorkspace(source);
    const settings = await pick(step(), "transfer:new-worktree");
    await pick(await pick(settings, "transfer:keep"), "transfer:go");
    await expect
      .poll(() => controller.getSnapshot().operation)
      .toEqual({ kind: "running", message: "Creating worktree…" });
    finish();
    await controller.settled();
    expect(controller.getSnapshot().operation.kind).toBe("idle");
  });
  it("alerts about the temporary branch in a dialog that stays open", async () => {
    const { controller, step } = setup("feat", true);
    controller.transferWorkspace(source);
    const settings = await pick(step(), "transfer:new-worktree");
    await pick(await pick(settings, "transfer:keep"), "transfer:go");
    await controller.settled();
    const finished = step();
    if (finished.kind !== "readOnly") throw Error("Expected the alert");
    expect(finished.lines().join()).toContain("temporary branch");
  });
});
