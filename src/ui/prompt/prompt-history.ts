import type { TimelineRow } from "../../state/timeline-store.js";

/** Which sent prompt the input shows: `index` into the newest-first list, or none. */
export type RecallState = { kind: "none" } | { kind: "shown"; index: number };
export const START: RecallState = { kind: "none" };

/** The prompts this agent was sent, newest first, skipping blanks and repeats in a row. */
export function sentPrompts(rows: readonly TimelineRow[]): string[] {
  const prompts: string[] = [];
  for (const { item } of rows) {
    if (item.type !== "user_message" || !item.text.trim()) continue;
    if (prompts.at(-1) !== item.text) prompts.push(item.text);
  }
  return prompts.reverse();
}

/**
 * Steps through sent prompts while the input is clean: empty, or still the prompt
 * it recalled. Null when there is nowhere to go or the user has edited the input,
 * so the key keeps its usual meaning.
 */
export function recall(
  entries: readonly string[],
  state: RecallState,
  text: string,
  direction: "older" | "newer",
): { state: RecallState; text: string } | null {
  const current: RecallState = text === "" ? START : state;
  if (current.kind === "shown" && entries[current.index] !== text) return null;
  if (current.kind === "none" && text !== "") return null;
  if (direction === "older") {
    const index = current.kind === "none" ? 0 : current.index + 1;
    const entry = entries[index];
    return entry === undefined
      ? null
      : { state: { kind: "shown", index }, text: entry };
  }
  if (current.kind === "none") return null;
  const index = current.index - 1;
  const entry = entries[index];
  return entry === undefined
    ? { state: START, text: "" }
    : { state: { kind: "shown", index }, text: entry };
}
