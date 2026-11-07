import stringWidth from "fast-string-width";
import type { WorkspaceTab } from "./workspaces.js";

export const TAB_MIN_WIDTH = 12;
export const TAB_MAX_WIDTH = 32;
/** Bar, status glyph + space, kind icon + space, space + close, and the gap to the next tab. */
const TAB_CHROME_WIDTH = 8;

export interface StripLayout {
  tabWidth: number;
  /** Tabs are wider than the strip, which scrolls to keep the selected tab in view. */
  overflow: boolean;
}

export function stripLayout(stripWidth: number, tabCount: number): StripLayout {
  if (tabCount * TAB_MIN_WIDTH > stripWidth)
    return { tabWidth: TAB_MIN_WIDTH, overflow: true };
  const even = Math.floor(stripWidth / Math.max(1, tabCount));
  return { tabWidth: Math.min(TAB_MAX_WIDTH, even), overflow: false };
}

export function tabNameWidth(tabWidth: number): number {
  return tabWidth - TAB_CHROME_WIDTH;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text` truncated with `…` and padded so it spans exactly `width` columns. */
export function fitToWidth(text: string, width: number): string {
  const full = stringWidth(text);
  if (full <= width) return text + " ".repeat(width - full);
  let fitted = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = stringWidth(segment);
    if (used + size > width - 1) break;
    fitted += segment;
    used += size;
  }
  fitted = fitted.trimEnd();
  return `${fitted}…${" ".repeat(width - 1 - stringWidth(fitted))}`;
}

export function tabKindIcon(kind: WorkspaceTab["kind"]): string {
  switch (kind) {
    case "agent":
      return "❯";
    case "terminal":
      return "▣";
    case "subagent":
      return "◆";
  }
}
