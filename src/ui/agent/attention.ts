import type { PaseoAgent } from "@getpaseo/client";
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
