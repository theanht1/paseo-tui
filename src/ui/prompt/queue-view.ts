import type { QueuedMessage } from "../../state/message-queue.js";
import type { Action } from "../input/keymap.js";

const VISIBLE = 3;
export interface QueueRow {
  id: string;
  label: string;
  selected: boolean;
}
/** Up to three queued messages (first line each) around the selection, plus how many are hidden. */
export function queueRows(
  items: readonly QueuedMessage[],
  selectedId: string | null,
): { rows: QueueRow[]; more: number } {
  const selected = items.findIndex((item) => item.id === selectedId);
  const start = Math.max(0, Math.min(selected - VISIBLE + 1, items.length));
  const rows = items.slice(start, start + VISIBLE).map((item, offset) => {
    const [first = "", ...rest] = item.text.split("\n");
    return {
      id: item.id,
      label: `⧗ ${start + offset + 1}. ${first}${rest.length ? " …" : ""}`,
      selected: item.id === selectedId,
    };
  });
  return { rows, more: items.length - rows.length };
}
/** The selection after moving `delta`; from none, up starts at the newest and down at the oldest. */
export function moveSelection(
  items: readonly QueuedMessage[],
  selectedId: string | null,
  delta: number,
): string | null {
  if (!items.length) return null;
  const index = items.findIndex((item) => item.id === selectedId);
  const next =
    index < 0
      ? delta < 0
        ? items.length - 1
        : 0
      : Math.max(0, Math.min(items.length - 1, index + delta));
  return items[next]?.id ?? null;
}
/** The message queue keys act on: the selected one, else the oldest. */
export function targetItem(
  items: readonly QueuedMessage[],
  selectedId: string | null,
): QueuedMessage | null {
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
}
/**
 * The line under the queue: its keys, how to resume a paused queue, or that a
 * multi-line message (`confirming`) needs the remove key again.
 */
export function queueHint(
  paused: boolean,
  confirming: string | null,
  shortcut: (action: Action) => string | null,
): string {
  const remove = shortcut({ type: "queue.remove" });
  if (confirming)
    return `${remove ?? "Remove"} again removes this multi-line message`;
  if (paused) return "Queue paused · Enter to resume";
  const up = shortcut({ type: "queue.select", delta: -1 });
  const down = shortcut({ type: "queue.select", delta: 1 });
  return [
    [shortcut({ type: "queue.send" }), "send now"],
    [shortcut({ type: "queue.edit" }), "edit"],
    [remove, "remove"],
    [up && down ? `${up} ${down}` : (up ?? down), "select"],
  ]
    .filter(([key]) => key)
    .map(([key, what]) => `${key} ${what}`)
    .join(" · ");
}
