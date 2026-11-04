import type { PaseoAgent, PaseoAgentListResult } from "@getpaseo/client";
import type { TimelinePage } from "./ports.js";

export function agent(
  id: string,
  overrides: Partial<PaseoAgent> = {},
): PaseoAgent {
  return {
    id,
    provider: "codex",
    cwd: "/project",
    workspaceId: "workspace",
    model: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    lastUserMessageAt: null,
    status: "idle",
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: id,
    labels: {},
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    ...overrides,
  };
}
export function listSnapshot(
  agents: PaseoAgent[],
): PaseoAgentListResult & { subscriptionId: string } {
  return {
    requestId: "list",
    subscriptionId: "subscription",
    entries: agents.map((value) => ({
      agent: value,
      project: {
        projectKey: "project",
        projectName: "Project",
        checkout: {
          cwd: value.cwd,
          isGit: false,
          currentBranch: null,
          remoteUrl: null,
          worktreeRoot: null,
          isPaseoOwnedWorktree: false,
          mainRepoRoot: null,
        },
      },
    })),
    pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
  };
}
export function page(
  seqs: number[],
  overrides: Partial<TimelinePage> = {},
): TimelinePage {
  const maxSeq = seqs.at(-1) ?? 0;
  const minSeq = seqs[0] ?? 0;
  return {
    requestId: "tail",
    agentId: "a",
    agent: null,
    direction: "tail",
    projection: "canonical",
    epoch: "epoch",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq, maxSeq, nextSeq: maxSeq + 1 },
    startCursor: { epoch: "epoch", seq: minSeq },
    endCursor: { epoch: "epoch", seq: maxSeq },
    hasOlder: false,
    hasNewer: false,
    error: null,
    entries: seqs.map((seq) => ({
      seqStart: seq,
      seqEnd: seq,
      timestamp: "2026-11-03T00:00:00Z",
      provider: "codex",
      item: { type: "assistant_message", text: String(seq) },
      sourceSeqRanges: [],
      collapsed: [],
    })),
    ...overrides,
  };
}
