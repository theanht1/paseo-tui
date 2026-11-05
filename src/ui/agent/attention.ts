import type { PaseoAgent } from "@getpaseo/client";
import {
  getWorkspaceStateBucketPriority,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";
import { createEmitter } from "../../state/emitter.js";

/** Ordered by precedence: question > permission > working > unread error > unread finished. */
export type Indicator =
  | { kind: "none" }
  | { kind: "question" }
  | { kind: "permission" }
  | { kind: "working" }
  | { kind: "unread"; reason: "finished" | "error" };

type AttentionFields = Pick<
  PaseoAgent,
  | "id"
  | "status"
  | "requiresAttention"
  | "attentionReason"
  | "attentionTimestamp"
  | "pendingPermissions"
>;

function attentionKey(agent: AttentionFields): string {
  return `${agent.id}@${agent.attentionTimestamp ?? ""}`;
}

export function agentIndicator(
  agent: AttentionFields,
  acknowledged: ReadonlySet<string>,
): Indicator {
  if (agent.pendingPermissions.some((request) => request.kind === "question"))
    return { kind: "question" };
  if (
    agent.pendingPermissions.length > 0 ||
    (agent.requiresAttention === true && agent.attentionReason === "permission")
  )
    return { kind: "permission" };
  if (agent.status === "running") return { kind: "working" };
  if (
    agent.requiresAttention === true &&
    (agent.attentionReason === "finished" ||
      agent.attentionReason === "error") &&
    !acknowledged.has(attentionKey(agent))
  )
    return { kind: "unread", reason: agent.attentionReason };
  return { kind: "none" };
}

export function groupIndicator(
  agents: readonly AttentionFields[],
  acknowledged: ReadonlySet<string>,
): Indicator {
  return agents
    .map((agent) => agentIndicator(agent, acknowledged))
    .reduce<Indicator>(
      (best, indicator) =>
        precedence(indicator) < precedence(best) ? indicator : best,
      { kind: "none" },
    );
}
function precedence(indicator: Indicator): number {
  switch (indicator.kind) {
    case "question":
      return 0;
    case "permission":
      return 1;
    case "working":
      return 2;
    case "unread":
      return indicator.reason === "error" ? 3 : 4;
    case "none":
      return 5;
  }
}

/** What the agent waits on, identified so a repeat of the same wait stays quiet. */
export function attentionWait(
  agent: AttentionFields,
  acknowledged: ReadonlySet<string>,
): { key: string; body: string } | null {
  const indicator = agentIndicator(agent, acknowledged);
  const requests = agent.pendingPermissions;
  const ids = requests.map((request) => request.id).join(",");
  switch (indicator.kind) {
    case "question":
      return { key: `question:${ids}`, body: "Has a question for you" };
    case "permission": {
      const tool = requests.find((request) => request.kind !== "question");
      return {
        key: `permission:${ids}@${agent.attentionTimestamp ?? ""}`,
        body: tool ? `Needs permission: ${tool.name}` : "Needs permission",
      };
    }
    case "unread":
      return {
        key: `${indicator.reason}@${agent.attentionTimestamp ?? ""}`,
        body: indicator.reason === "error" ? "Failed" : "Finished",
      };
    case "working":
    case "none":
      return null;
  }
}
/** The daemon's status bucket for an indicator, so local "read" state is respected. */
export function indicatorBucket(indicator: Indicator): WorkspaceStateBucket {
  switch (indicator.kind) {
    case "question":
    case "permission":
      return "needs_input";
    case "working":
      return "running";
    case "unread":
      return indicator.reason === "error" ? "failed" : "attention";
    case "none":
      return "done";
  }
}
/** A workspace's most act-on-first bucket (failed outranks running, unlike its glyph). */
export function workspaceBucket(
  agents: readonly AttentionFields[],
  acknowledged: ReadonlySet<string>,
): WorkspaceStateBucket {
  return agents
    .map((agent) => indicatorBucket(agentIndicator(agent, acknowledged)))
    .reduce<WorkspaceStateBucket>(
      (best, bucket) =>
        getWorkspaceStateBucketPriority(bucket) <
        getWorkspaceStateBucketPriority(best)
          ? bucket
          : best,
      "done",
    );
}
const WAITING: ReadonlySet<WorkspaceStateBucket> = new Set([
  "needs_input",
  "failed",
  "attention",
]);
/** Live agents waiting on you, most urgent first, then most recent. */
export function attentionQueue<
  T extends AttentionFields & Pick<PaseoAgent, "updatedAt" | "archivedAt">,
>(agents: readonly T[], acknowledged: ReadonlySet<string>): T[] {
  return agents
    .filter((agent) => agent.archivedAt == null)
    .map((agent) => ({
      agent,
      bucket: indicatorBucket(agentIndicator(agent, acknowledged)),
      at: Date.parse(agent.attentionTimestamp ?? agent.updatedAt) || 0,
    }))
    .filter(({ bucket }) => WAITING.has(bucket))
    .sort(
      (a, b) =>
        getWorkspaceStateBucketPriority(a.bucket) -
          getWorkspaceStateBucketPriority(b.bucket) || b.at - a.at,
    )
    .map(({ agent }) => agent);
}
/** The queued agent after `currentId`, wrapping; the head when current is not queued. */
export function nextAttention<T extends { id: string }>(
  queue: readonly T[],
  currentId: string | null,
): T | null {
  const index = queue.findIndex((agent) => agent.id === currentId);
  return queue[(index + 1) % Math.max(queue.length, 1)] ?? null;
}

export function createAttentionTracker(
  clear: (agentId: string) => Promise<void>,
) {
  const emitter = createEmitter();
  let acknowledged: ReadonlySet<string> = new Set();
  return {
    getSnapshot: () => acknowledged,
    subscribe: emitter.subscribe,
    view(agent: AttentionFields) {
      if (agentIndicator(agent, acknowledged).kind !== "unread") return;
      acknowledged = new Set(acknowledged).add(attentionKey(agent));
      emitter.notify();
      clear(agent.id).catch(() => {});
    },
  };
}
