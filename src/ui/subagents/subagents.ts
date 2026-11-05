import type { PaseoAgent } from "@getpaseo/client";
import { getParentAgentIdFromLabels } from "@getpaseo/protocol/agent-labels";
import type { ProviderSubagent } from "../../connection/ports.js";
import { agentName } from "../agent/agent-display.js";
import type { TimelineAgent } from "../timeline/TimelineView.js";

/** The Paseo app merges delegated Paseo agents (parent label) with provider-owned subagents. */
export type SubagentEntry =
  | { kind: "paseo"; agent: PaseoAgent }
  | { kind: "provider"; descriptor: ProviderSubagent };
export type SubagentBucket =
  | "needs_input"
  | "failed"
  | "running"
  | "attention"
  | "done";
export interface SubagentRow {
  key: string;
  label: string;
  subtitle: string;
  bucket: SubagentBucket;
}
export const BUCKET_LABEL: Record<SubagentBucket, string> = {
  needs_input: "needs input",
  failed: "failed",
  running: "working",
  attention: "ready to review",
  done: "done",
};
const PILL_ORDER: readonly SubagentBucket[] = [
  "needs_input",
  "failed",
  "attention",
  "running",
];

export function parentAgentId(
  agent: Pick<PaseoAgent, "labels">,
): string | null {
  return getParentAgentIdFromLabels(agent.labels);
}
export function subagentKey(entry: SubagentEntry): string {
  return entry.kind === "paseo"
    ? `paseo:${entry.agent.id}`
    : `provider:${entry.descriptor.id}`;
}
function createdAt(entry: SubagentEntry): number {
  return Date.parse(
    entry.kind === "paseo" ? entry.agent.createdAt : entry.descriptor.createdAt,
  );
}
export function subagentsOf(
  parentId: string,
  agents: readonly PaseoAgent[],
  descriptors: readonly ProviderSubagent[],
): SubagentEntry[] {
  return [
    ...agents
      .filter(
        (agent) =>
          agent.archivedAt == null && parentAgentId(agent) === parentId,
      )
      .map((agent): SubagentEntry => ({ kind: "paseo", agent })),
    ...descriptors
      .filter(
        (descriptor) =>
          descriptor.parentAgentId === parentId &&
          (descriptor.parentSubagentId ?? null) === null,
      )
      .map((descriptor): SubagentEntry => ({ kind: "provider", descriptor })),
  ].toSorted((a, b) => createdAt(a) - createdAt(b));
}
export function subagentBucket(entry: SubagentEntry): SubagentBucket {
  if (entry.kind === "provider")
    return entry.descriptor.status === "running"
      ? "running"
      : entry.descriptor.status === "failed"
        ? "failed"
        : "done";
  const { agent } = entry;
  if (
    agent.pendingPermissions.length > 0 ||
    agent.attentionReason === "permission"
  )
    return "needs_input";
  if (agent.status === "error" || agent.attentionReason === "error")
    return "failed";
  if (agent.status === "running") return "running";
  if (agent.requiresAttention) return "attention";
  return "done";
}
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.toLowerCase() !== "new agent" ? trimmed : null;
}
export function subagentRow(entry: SubagentEntry): SubagentRow {
  const bucket = subagentBucket(entry);
  const key = subagentKey(entry);
  if (entry.kind === "paseo")
    return {
      key,
      label: agentName(entry.agent),
      subtitle: [entry.agent.provider, entry.agent.model]
        .filter(Boolean)
        .join("/"),
      bucket,
    };
  const description = text(entry.descriptor.description);
  const title = text(entry.descriptor.title);
  return {
    key,
    label: description ?? title ?? "Subagent",
    subtitle:
      text(entry.descriptor.subtitle) ?? (description ? title : null) ?? "",
    bucket,
  };
}
export function subagentPill(entries: readonly SubagentEntry[]): {
  text: string;
  running: boolean;
} {
  const buckets = entries.map(subagentBucket);
  const count = `◆ ${entries.length} subagent${entries.length === 1 ? "" : "s"}`;
  const segments = PILL_ORDER.flatMap((bucket) => {
    const n = buckets.filter((value) => value === bucket).length;
    if (!n) return [];
    if (bucket === "needs_input")
      return [n === 1 ? "1 needs input" : `${n} need input`];
    return [`${n} ${BUCKET_LABEL[bucket]}`];
  });
  return {
    text: segments.length ? `${count} · ${segments.join(", ")}` : count,
    running: buckets.includes("running"),
  };
}
/** Chat header fields for a provider subagent (lifecycle mapped like the Paseo app). */
export function providerHeader(
  descriptor: ProviderSubagent,
  parentCwd: string,
): TimelineAgent {
  return {
    id: descriptor.id,
    title: subagentRow({ kind: "provider", descriptor }).label,
    provider: descriptor.provider,
    model: null,
    availableModes: [],
    currentModeId: null,
    status:
      descriptor.status === "running"
        ? "running"
        : descriptor.status === "failed"
          ? "error"
          : "idle",
    cwd: descriptor.cwd ?? parentCwd,
    activeTurn: null,
  };
}
