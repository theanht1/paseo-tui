import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import type { CheckoutPort, ForkAttachment } from "../../connection/ports.js";
import type { CreateAgentInput } from "../../state/ports.js";
import { agentName } from "../agent/agent-display.js";
import { defaultBaseBranch } from "./base-branch.js";
import type { WorkspaceRow } from "./workspaces.js";

export type TransferDestination =
  /** The source workspace itself: only the agents are recreated; git is left alone. */
  | { kind: "current" }
  /** On the source's host. `branchName` names the branch when the source is on the default branch; null auto-names it. */
  | { kind: "new-worktree"; project: PaseoProject; branchName: string | null }
  | { kind: "existing"; workspace: WorkspaceRow }
  /** Only committed work reaches another host: a branch is pushed, the default branch is branched off there. */
  | {
      kind: "other-host-worktree";
      project: PaseoProject;
      branchName: string | null;
    };
/** Provider settings every moved agent gets instead of its own. */
export interface AgentSettings {
  provider: string;
  model: string;
  modeId: string | null;
  thinkingOptionId?: string;
}
export type WorktreeSpec =
  | { kind: "checkout"; branch: string }
  | { kind: "branch-off"; base: string; branch: string | null };
export interface TransferRequest {
  source: WorkspaceRow;
  destination: TransferDestination;
  /** The agents to move. */
  agents: readonly PaseoAgent[];
  /** Every agent in the source workspace; a running one would see its files change. */
  workspaceAgents: readonly PaseoAgent[];
  /** Null keeps each agent's own provider, model, mode and thinking. */
  settings: AgentSettings | null;
}
export interface TransferDeps {
  sourceGit: CheckoutPort;
  targetGit: CheckoutPort;
  /** A short id making temporary branch and stash names unique. */
  unique(): string;
  createWorktree(
    project: PaseoProject,
    spec: WorktreeSpec,
  ): Promise<WorkspaceRow>;
  forkChat(agent: PaseoAgent): Promise<ForkAttachment>;
  createAgent(
    workspace: WorkspaceRow,
    input: CreateAgentInput,
  ): Promise<PaseoAgent>;
  /** The step under way, for the status bar. */
  progress(message: string): void;
}
export interface TransferResult {
  workspace: WorkspaceRow;
  agents: readonly PaseoAgent[];
  /** What the user must know: a temporary branch, a kept stash, an agent left behind. */
  notices: readonly string[];
}
type Parked = { kind: "switched" } | { kind: "renamed"; temporary: string };
interface Placed {
  workspace: WorkspaceRow;
  notices: string[];
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function requireBase(baseRef: string | null) {
  const base = defaultBaseBranch([], baseRef);
  if (!base) throw Error("Can't tell this repository's default branch");
  return base;
}
function requireBranch(branch: string | null) {
  if (!branch) throw Error("Check out a branch before transferring");
  return branch;
}

async function moveAcrossHosts(
  request: TransferRequest,
  destination: Extract<TransferDestination, { kind: "other-host-worktree" }>,
  deps: TransferDeps,
): Promise<Placed> {
  const { project } = destination;
  const cwd = request.source.workspaceDirectory;
  const status = await deps.sourceGit.status(cwd);
  if (status.dirty)
    throw Error(
      "Commit or stash your changes first: uncommitted work can't move to another host",
    );
  const branch = requireBranch(status.branch);
  const base = requireBase(status.baseRef);
  if (branch === base) {
    deps.progress("Creating worktree…");
    const workspace = await deps.createWorktree(project, {
      kind: "branch-off",
      base,
      branch: destination.branchName,
    });
    return { workspace, notices: [] };
  }
  deps.progress(`Pushing ${branch}…`);
  await deps.sourceGit.push(cwd);
  deps.progress("Creating worktree…");
  const workspace = await deps.createWorktree(project, {
    kind: "checkout",
    branch,
  });
  return { workspace, notices: [] };
}

async function moveOnHost(
  request: TransferRequest,
  destination: Exclude<
    TransferDestination,
    { kind: "other-host-worktree" } | { kind: "current" }
  >,
  deps: TransferDeps,
): Promise<Placed> {
  const { sourceGit, targetGit } = deps;
  const cwd = request.source.workspaceDirectory;
  const status = await sourceGit.status(cwd);
  const branch = requireBranch(status.branch);
  const base = requireBase(status.baseRef);
  if (destination.kind === "existing") {
    const there = await targetGit.status(
      destination.workspace.workspaceDirectory,
    );
    if (there.dirty)
      throw Error("The destination has uncommitted changes; clean it up first");
  }
  const unique = deps.unique();
  const label = `paseo-transfer-${unique}`;
  const notices: string[] = [];
  if (status.dirty) await sourceGit.stash(cwd, label);
  let parked: Parked | null = null;
  async function park(): Promise<Parked> {
    try {
      await sourceGit.switchBranch(cwd, base);
      return { kind: "switched" };
    } catch (error) {
      if (destination.kind === "existing")
        throw Error(
          `Can't free ${branch} because ${base} isn't available (${message(error)}). Transfer to a new worktree instead.`,
        );
    }
    const temporary = `paseo-transfer-${branch.replace(/[^\w.-]+/g, "-")}-${unique}`;
    await sourceGit.renameBranch(cwd, temporary);
    notices.push(
      `${base} is checked out elsewhere, so the original checkout is on temporary branch ${temporary}`,
    );
    return { kind: "renamed", temporary };
  }
  function spec(current: Parked | null): WorktreeSpec {
    if (current === null)
      return {
        kind: "branch-off",
        base,
        branch:
          destination.kind === "new-worktree" ? destination.branchName : null,
      };
    return current.kind === "switched"
      ? { kind: "checkout", branch }
      : { kind: "branch-off", base: current.temporary, branch };
  }
  async function place() {
    if (destination.kind === "new-worktree") {
      deps.progress("Creating worktree…");
      return deps.createWorktree(destination.project, spec(parked));
    }
    deps.progress(`Checking out ${branch}…`);
    if (branch !== base)
      await targetGit.switchBranch(
        destination.workspace.workspaceDirectory,
        branch,
      );
    return destination.workspace;
  }
  async function restore() {
    if (parked?.kind === "switched") await sourceGit.switchBranch(cwd, branch);
    if (parked?.kind === "renamed") await sourceGit.renameBranch(cwd, branch);
    if (status.dirty) await sourceGit.unstash(cwd, label);
  }
  let workspace: WorkspaceRow;
  try {
    if (branch !== base) parked = await park();
    workspace = await place();
  } catch (error) {
    await restore().catch((failure: unknown) => {
      throw Error(
        `${message(error)}. Undoing it also failed: ${message(failure)}. Your changes may be in stash ${label}.`,
      );
    });
    throw error;
  }
  if (status.dirty) deps.progress("Moving your changes…");
  if (status.dirty)
    await targetGit
      .unstash(workspace.workspaceDirectory, label)
      .catch((error: unknown) =>
        notices.push(
          `Your uncommitted changes are still in stash ${label}: ${message(error)}`,
        ),
      );
  return { workspace, notices };
}

function sameWorkspacePrompt(agent: PaseoAgent) {
  const from = [agent.provider, agent.model].filter(Boolean).join(" · ");
  return `This conversation was transferred from another agent (${agentName(agent)}, ${from}) to you. The attachment holds the chat so far. Continue the work from where it left off. Reply briefly that you're ready and wait for the next instruction.`;
}
function handoffPrompt(from: string, to: string) {
  return `This conversation was transferred from ${from} to this workspace (${to}). The attachment holds the chat so far, and the branch and uncommitted changes came with it. Work here from now on. Reply briefly that you're ready and wait for the next instruction.`;
}

function ownSettings(agent: PaseoAgent): AgentSettings | null {
  if (!agent.model) return null;
  return {
    provider: agent.provider,
    model: agent.model,
    modeId: agent.currentModeId,
    ...(agent.thinkingOptionId
      ? { thinkingOptionId: agent.thinkingOptionId }
      : {}),
  };
}
async function moveAgents(
  request: TransferRequest,
  workspace: WorkspaceRow,
  deps: TransferDeps,
) {
  const agents: PaseoAgent[] = [];
  const notices: string[] = [];
  for (const agent of request.agents) {
    const name = agentName(agent);
    const settings = request.settings ?? ownSettings(agent);
    if (!settings) {
      notices.push(
        `${name} stayed behind: it has no model to recreate it with`,
      );
      continue;
    }
    deps.progress(`Moving ${name}…`);
    try {
      const attachment = await deps.forkChat(agent);
      agents.push(
        await deps.createAgent(workspace, {
          ...settings,
          attachments: [attachment],
          cwd: workspace.workspaceDirectory,
          title: agent.title,
          prompt:
            request.destination.kind === "current"
              ? sameWorkspacePrompt(agent)
              : handoffPrompt(
                  request.source.workspaceDirectory,
                  workspace.workspaceDirectory,
                ),
        }),
      );
    } catch (error) {
      notices.push(`${name} stayed behind: ${message(error)}`);
    }
  }
  return { agents, notices };
}

/**
 * Moves a workspace's branch and uncommitted work elsewhere (or nowhere, for the
 * current workspace) and recreates the chosen agents there with their chat; the
 * originals stay.
 */
export async function transferWorkspace(
  request: TransferRequest,
  deps: TransferDeps,
): Promise<TransferResult> {
  const { destination } = request;
  if (
    destination.kind !== "current" &&
    request.workspaceAgents.some((agent) => agent.status === "running")
  )
    throw Error("Stop the running agents in this workspace first");
  const placed: Placed =
    destination.kind === "current"
      ? { workspace: request.source, notices: [] }
      : destination.kind === "other-host-worktree"
        ? await moveAcrossHosts(request, destination, deps)
        : await moveOnHost(request, destination, deps);
  const moved = await moveAgents(request, placed.workspace, deps);
  return {
    workspace: placed.workspace,
    agents: moved.agents,
    notices: [...placed.notices, ...moved.notices],
  };
}
