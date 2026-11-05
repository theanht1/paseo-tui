import type {
  AgentTimelineItem,
  ToolCallTimelineItem,
} from "@getpaseo/protocol/agent-types";

type TimelineItem = AgentTimelineItem | { type: string };
export type PlanOutcome = "proposed" | "approved" | "rejected" | "canceled";
export type Block =
  | { kind: "user" | "assistant" | "reasoning"; key: string; text: string }
  | { kind: "tool"; key: string; call: ToolCallTimelineItem }
  | { kind: "plan"; key: string; outcome: PlanOutcome; text: string }
  | {
      kind: "todo";
      key: string;
      items: readonly { text: string; completed: boolean }[];
    }
  | { kind: "error"; key: string; message: string }
  | { kind: "notice"; key: string; text: string }
  | { kind: "unknown"; key: string; type: string };
const KNOWN_TYPES: ReadonlySet<string> = new Set<AgentTimelineItem["type"]>([
  "user_message",
  "assistant_message",
  "reasoning",
  "tool_call",
  "todo",
  "error",
  "notification",
  "compaction",
  "plugin",
]);

function isKnown(item: TimelineItem): item is AgentTimelineItem {
  return KNOWN_TYPES.has(item.type);
}

/**
 * The daemon records a plan proposal as a tool call with a `plan` detail and
 * settles it in place: `metadata.approved` false when the user rejected or
 * steered past it, `canceled` when the turn was interrupted.
 */
function planOutcome(call: ToolCallTimelineItem): PlanOutcome {
  if (call.status === "canceled") return "canceled";
  if (call.metadata?.approved === false) return "rejected";
  if (call.metadata?.approved === true) return "approved";
  return "proposed";
}
export function planLabel(outcome: PlanOutcome): string {
  switch (outcome) {
    case "proposed":
      return "Plan";
    case "approved":
      return "Approved plan";
    case "rejected":
      return "Rejected plan";
    case "canceled":
      return "Canceled plan";
  }
}
/** Blocks the block toggle (`{` `}` `o` `O`) selects and expands. */
export function isExpandable(block: Block): boolean {
  return (
    block.kind === "tool" || block.kind === "reasoning" || block.kind === "plan"
  );
}

/** `owners`, when given, receives the block key of every user and assistant message row. */
export function toBlocks(
  rows: readonly { seq: number; item: TimelineItem }[],
  owners?: Map<number, string>,
): Block[] {
  const latest = new Map<string, ToolCallTimelineItem>();
  for (const { item } of rows)
    if (isKnown(item) && item.type === "tool_call")
      latest.set(item.callId, item);
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const { seq, item } of rows) {
    if (!isKnown(item)) {
      blocks.push({ kind: "unknown", key: `unknown:${seq}`, type: item.type });
      continue;
    }
    if (item.type === "tool_call") {
      if (seen.has(item.callId)) continue;
      seen.add(item.callId);
      const call = latest.get(item.callId) ?? item;
      if (call.detail.type === "plan") {
        // A running plan is awaiting approval; the permission card shows it.
        if (call.status !== "running")
          blocks.push({
            kind: "plan",
            key: `plan:${call.callId}`,
            outcome: planOutcome(call),
            text: call.detail.text,
          });
        continue;
      }
      blocks.push({ kind: "tool", key: `tool:${item.callId}`, call });
      continue;
    }
    if (item.type === "assistant_message" || item.type === "reasoning") {
      const kind = item.type === "reasoning" ? "reasoning" : "assistant";
      const previous = blocks.at(-1);
      const key = previous?.kind === kind ? previous.key : `${kind}:${seq}`;
      if (previous?.kind === kind) previous.text += item.text;
      else blocks.push({ kind, key, text: item.text });
      if (kind === "assistant") owners?.set(seq, key);
      continue;
    }
    switch (item.type) {
      case "user_message":
        blocks.push({ kind: "user", key: `user:${seq}`, text: item.text });
        owners?.set(seq, `user:${seq}`);
        break;
      case "todo":
        blocks.push({ kind: "todo", key: `todo:${seq}`, items: item.items });
        break;
      case "error":
        blocks.push({
          kind: "error",
          key: `error:${seq}`,
          message: item.message,
        });
        break;
      case "notification":
        blocks.push({
          kind: "notice",
          key: `notice:${seq}`,
          text: item.message,
        });
        break;
      case "compaction":
        blocks.push({
          kind: "notice",
          key: `notice:${seq}`,
          text: `compaction ${item.status}`,
        });
        break;
      case "plugin":
        blocks.push({ kind: "notice", key: `notice:${seq}`, text: "[plugin]" });
        break;
    }
  }
  return blocks;
}
export function blockText(block: Block): string {
  switch (block.kind) {
    case "unknown":
      return `[${block.type}]`;
    case "error":
      return block.message;
    case "plan":
      return `${planLabel(block.outcome)}\n${block.text}`;
    case "todo":
      return block.items.map((i) => i.text).join("\n");
    case "tool":
      return `${block.call.name} ${Object.values(block.call.detail)
        .filter((v) => typeof v === "string")
        .join("\n")}`;
    default:
      return block.text;
  }
}
