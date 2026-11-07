import type { PaseoAgent } from "@getpaseo/client";
import type { ProviderSubagent } from "../../connection/ports.js";
import { agentName } from "../agent/agent-display.js";
import {
  parentAgentId,
  type SubagentBucket,
  type SubagentEntry,
  subagentPill,
  subagentRow,
  subagentsOf,
} from "./subagents.js";

/** A pane showing a provider subagent's chat instead of its parent agent's. */
export interface ProviderView {
  parentAgentId: string;
  subagentId: string;
}
export interface PaneSubagents {
  /** Where "back" goes: the parent of the delegated or provider subagent on screen. */
  parent: { agentId: string; label: string } | null;
  /** The agent whose subagents are listed. */
  parentId: string;
  entries: SubagentEntry[];
  pill: { text: string; running: boolean };
}
export type SubagentPopupRow =
  | { kind: "parent"; key: "parent"; agentId: string; label: string }
  | {
      kind: "subagent";
      key: string;
      entry: SubagentEntry;
      label: string;
      subtitle: string;
      bucket: SubagentBucket;
    };

export function paneSubagents(
  agent: PaseoAgent | undefined,
  view: ProviderView | null,
  agents: readonly PaseoAgent[],
  descriptors: readonly ProviderSubagent[],
): PaneSubagents | null {
  if (!agent) return null;
  const parentId = view ? view.parentAgentId : parentAgentId(agent);
  const listed = view ? view.parentAgentId : agent.id;
  const entries = subagentsOf(listed, agents, descriptors);
  if (!parentId && entries.length === 0) return null;
  const parentAgent = agents.find((candidate) => candidate.id === parentId);
  return {
    parent: parentId
      ? {
          agentId: parentId,
          label: parentAgent ? agentName(parentAgent) : parentId.slice(0, 8),
        }
      : null,
    parentId: listed,
    entries,
    pill: subagentPill(entries),
  };
}
export function popupRows(view: PaneSubagents | null): SubagentPopupRow[] {
  if (!view) return [];
  return [
    ...(view.parent
      ? [
          {
            kind: "parent" as const,
            key: "parent" as const,
            agentId: view.parent.agentId,
            label: `Go to parent tab (${view.parent.label})`,
          },
        ]
      : []),
    ...view.entries.map((entry): SubagentPopupRow => {
      const row = subagentRow(entry);
      return { kind: "subagent", entry, ...row };
    }),
  ];
}
