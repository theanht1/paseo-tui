import type {
  AgentTimelineItem,
  ToolCallTimelineItem,
} from "@getpaseo/protocol/agent-types";

type TimelineItem = AgentTimelineItem | { type: string };
export type Block =
  | { kind: "user" | "assistant" | "reasoning"; key: string; text: string }
  | { kind: "tool"; key: string; call: ToolCallTimelineItem }
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

export function toBlocks(
  rows: readonly { seq: number; item: TimelineItem }[],
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
      if (!seen.has(item.callId)) {
        seen.add(item.callId);
        blocks.push({
          kind: "tool",
          key: `tool:${item.callId}`,
          call: latest.get(item.callId) ?? item,
        });
      }
      continue;
    }
    if (item.type === "assistant_message" || item.type === "reasoning") {
      const kind = item.type === "reasoning" ? "reasoning" : "assistant";
      const previous = blocks.at(-1);
      if (previous?.kind === kind) previous.text += item.text;
      else blocks.push({ kind, key: `${kind}:${seq}`, text: item.text });
      continue;
    }
    switch (item.type) {
      case "user_message":
        blocks.push({ kind: "user", key: `user:${seq}`, text: item.text });
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
