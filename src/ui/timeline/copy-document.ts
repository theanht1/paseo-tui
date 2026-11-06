import {
  type DocLine,
  type LineStyle,
  type Mark,
  styledDocumentLines,
  type Tone,
} from "../copy/copy-mode.js";
import {
  type Block,
  blockText,
  planLabel,
  toolGlyph,
  toolSummary,
} from "./blocks.js";

/** A block's text as the pane draws it: collapsed blocks give their summary line only. */
export function blockCopyText(block: Block, expanded: boolean): string {
  const body = (header: string, text: string) =>
    expanded ? `${header}\n${text}` : header;
  switch (block.kind) {
    case "reasoning":
      return body(
        `∴ thinking · ${block.text.split("\n").length} lines`,
        block.text,
      );
    case "tool": {
      const { call } = block;
      const header = `${toolGlyph(call.status)} ${call.name} ${toolSummary(call.detail).replace(/\s+/g, " ")}`;
      return body(
        header.trimEnd(),
        call.detail.type === "shell"
          ? `$ ${call.detail.command}\n${call.detail.output ?? ""}`.trimEnd()
          : blockText(block).slice(call.name.length + 1),
      );
    }
    case "plan":
      return expanded
        ? `▾ ${planLabel(block.outcome)}\n${block.text}`
        : `▸ ${planLabel(block.outcome)}`;
    case "todo":
      return block.items
        .map((item) => `${item.completed ? "☑" : "☐"} ${item.text}`)
        .join("\n");
    case "error":
      return `! ${block.message}`;
    case "notice":
      return block.text.replace(/\s+/g, " ");
    default:
      return blockText(block);
  }
}
type StyledLine = { text: string; style: LineStyle };
function plain(text: string, tone: Tone, bold = false): StyledLine[] {
  return text.split("\n").map((line) => ({
    text: line,
    style: { tone, bold, marks: [] },
  }));
}
/** Code-point index of a UTF-16 offset in `text`. */
function column(text: string, offset: number) {
  return Array.from(text.slice(0, offset)).length;
}
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
/** Inline markdown as the timeline styles it: code, bold, links; markers are faint. */
function inlineMarks(line: string): Mark[] {
  const marks: Mark[] = [];
  for (const match of line.matchAll(INLINE)) {
    const start = column(line, match.index);
    const end = start + Array.from(match[0]).length;
    if (match[1] !== undefined)
      marks.push(
        { start, end: start + 1, tone: "faint" },
        { start: start + 1, end: end - 1, tone: "tool" },
        { start: end - 1, end, tone: "faint" },
      );
    else if (match[2] !== undefined)
      marks.push(
        { start, end: start + 2, tone: "faint" },
        { start: start + 2, end: end - 2, tone: "fg", bold: true },
        { start: end - 2, end, tone: "faint" },
      );
    else marks.push({ start, end, tone: "accent" });
  }
  return marks;
}
const HEADINGS: readonly Tone[] = ["heading1", "heading2", "heading3"];
function markdownLines(text: string): StyledLine[] {
  let fenced = false;
  return text.split("\n").map((line): StyledLine => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return { text: line, style: { tone: "faint", bold: false, marks: [] } };
    }
    if (fenced)
      return { text: line, style: { tone: "tool", bold: false, marks: [] } };
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading?.[1]) {
      const level = Math.min(heading[1].length, 3);
      return {
        text: line,
        style: {
          tone: HEADINGS[level - 1] ?? "heading3",
          bold: true,
          marks: [{ start: 0, end: heading[1].length, tone: "faint" }],
        },
      };
    }
    return {
      text: line,
      style: { tone: "fg", bold: false, marks: inlineMarks(line) },
    };
  });
}
function toolTone(status: string): Tone {
  return status === "running"
    ? "warn"
    : status === "completed"
      ? "success"
      : status === "failed"
        ? "error"
        : "muted";
}
/** A block's copy-mode lines in the timeline's colors. */
function blockCopyLines(block: Block, expanded: boolean): StyledLine[] {
  const text = blockCopyText(block, expanded);
  const [header = "", ...body] = text.split("\n");
  const rest = body.join("\n");
  const headed = (tone: Tone, bodyLines: () => StyledLine[]) => [
    ...plain(header, tone),
    ...(body.length ? bodyLines() : []),
  ];
  switch (block.kind) {
    case "user":
      return plain(text, "user", true);
    case "assistant":
      return markdownLines(text);
    case "reasoning":
      return headed("reasoning", () => plain(rest, "muted"));
    case "tool":
      return headed(toolTone(block.call.status), () => plain(rest, "fg"));
    case "plan":
      return headed(
        block.outcome === "approved"
          ? "success"
          : block.outcome === "proposed"
            ? "accent"
            : "muted",
        () => markdownLines(rest),
      );
    case "todo":
      return block.items.flatMap((item, index) =>
        plain(
          text.split("\n")[index] ?? item.text,
          item.completed ? "muted" : "fg",
        ),
      );
    case "error":
      return plain(text, "error");
    default:
      return plain(text, "muted");
  }
}
/** The copy-mode document, plus the row each block starts on (to keep the cursor when older blocks load). */
export function copyDocument(
  blocks: readonly Block[],
  expanded: ReadonlySet<string>,
  width: number,
): { lines: DocLine[]; starts: Map<string, number> } {
  const lines: DocLine[] = [];
  const starts = new Map<string, number>();
  blocks.forEach((block, index) => {
    if (index)
      lines.push({
        text: "",
        continued: false,
        style: { tone: "fg", bold: false, marks: [] },
      });
    starts.set(block.key, lines.length);
    lines.push(
      ...styledDocumentLines(
        blockCopyLines(block, expanded.has(block.key)),
        width,
      ),
    );
  });
  return { lines, starts };
}
