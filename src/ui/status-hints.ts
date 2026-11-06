import stringWidth from "fast-string-width";

const HELP = "? shortcuts";
const SEPARATOR = " · ";
export function fitHints(hints: readonly string[], width: number): string {
  const selected: string[] = [];
  let used = stringWidth(HELP);
  for (const hint of hints) {
    if (hint === HELP || hint.startsWith("? ")) continue;
    const size = stringWidth(hint) + stringWidth(SEPARATOR);
    if (used + size <= width) {
      selected.push(hint);
      used += size;
    }
  }
  return [...selected, HELP].join(SEPARATOR);
}
export function truncateCells(text: string, width: number): string {
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    if (stringWidth(result + segment) > width) break;
    result += segment;
  }
  return result;
}
export function statusLine(
  width: number,
  status: string,
  hints: readonly string[],
): string {
  const head = truncateCells(
    status,
    Math.max(0, width - stringWidth(HELP) - 3),
  );
  const tail = fitHints(hints, width - stringWidth(head) - (head ? 3 : 0));
  return head ? `${head}${SEPARATOR}${tail}` : tail;
}

export interface StatusLabelInput {
  label: string;
  quitPending: boolean;
  notice: string | null;
  operation: string | null;
  createError: string | null;
  /** Queued messages across agents; quitting loses them. */
  queued?: number;
}
/** The status bar's left text: the most urgent message, else the connection label. */
export function statusLabel(input: StatusLabelInput): string {
  if (input.quitPending) {
    const queued = input.queued ?? 0;
    return queued
      ? `Press Ctrl+C again to quit · ${queued} queued message${queued === 1 ? "" : "s"} will be lost`
      : "Press Ctrl+C again to quit";
  }
  if (input.notice) return input.notice;
  if (input.operation) return input.operation;
  if (input.createError) return `! ${input.createError} · ${input.label}`;
  return input.label;
}
