import type { PaseoAgent } from "@getpaseo/client";
import { agentName } from "../agent/agent-display.js";
import { attentionWait } from "../agent/attention.js";

export interface AttentionNotification {
  agentId: string;
  title: string;
  body: string;
}
type NotifiedAgent = Pick<
  PaseoAgent,
  | "id"
  | "title"
  | "status"
  | "requiresAttention"
  | "attentionReason"
  | "attentionTimestamp"
  | "pendingPermissions"
>; /** Turns agent snapshots into one notification per new wait, after a silent first snapshot. */
export function createAttentionNotifier() {
  let previous: Map<string, string | null> | null = null;
  return {
    update(
      agents: readonly NotifiedAgent[],
      acknowledged: ReadonlySet<string>,
      isShown: (agentId: string) => boolean,
    ): AttentionNotification[] {
      const next = new Map<string, string | null>();
      const notifications: AttentionNotification[] = [];
      for (const agent of agents) {
        const current = attentionWait(agent, acknowledged);
        next.set(agent.id, current?.key ?? null);
        if (
          previous &&
          current &&
          previous.get(agent.id) !== current.key &&
          !isShown(agent.id)
        )
          notifications.push({
            agentId: agent.id,
            title: agentName(agent),
            body: current.body,
          });
      }
      previous = next;
      return notifications;
    },
  };
}
