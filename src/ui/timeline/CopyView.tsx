import { TextAttributes } from "@opentui/core";
import { useContext } from "react";
import { type CopyState, selectionSpan, type Tone } from "../copy/copy-mode.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "../render/theme.js";

const WHEEL_LINES = 3;
/** The theme color the timeline draws a tone in. */
function toneColor(theme: Theme, tone: Tone): string {
  switch (tone) {
    case "heading1":
      return theme.heading[0];
    case "heading2":
      return theme.heading[1];
    case "heading3":
      return theme.heading[2];
    default:
      return theme[tone];
  }
}
/** Without colours (NO_COLOR) the selection is reverse video and the cursor also bold+underlined. */
function copyStyle(theme: Theme, kind: "selected" | "cursor") {
  const cursor = kind === "cursor";
  const bg = cursor ? theme.copyCursorBg : theme.copySelectionBg;
  const fg = cursor ? theme.copyCursorFg : theme.copySelectionFg;
  const emphasis = cursor ? TextAttributes.BOLD : 0;
  return bg
    ? { bg: backgroundProp(bg), fg: foregroundProp(fg), attributes: emphasis }
    : {
        attributes:
          TextAttributes.INVERSE |
          (cursor ? emphasis | TextAttributes.UNDERLINE : 0),
      };
}
export function CopyView({
  state,
  onScroll,
}: {
  state: CopyState;
  /** Mouse wheel, in lines: negative is up. */
  onScroll(lines: number): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  // While typing a search its prompt takes the bottom row, as in tmux.
  const rows = state.lines.slice(
    state.top,
    state.top + state.pageSize - (state.search ? 1 : 0),
  );
  return (
    <box
      id="copy-mode"
      flexDirection="column"
      flexGrow={1}
      minHeight={1}
      onMouseScroll={(event) => {
        const direction = event.scroll?.direction;
        if (direction === "up") onScroll(-WHEEL_LINES);
        else if (direction === "down") onScroll(WHEEL_LINES);
      }}
    >
      {rows.map((line, offset) => {
        const row = state.top + offset;
        const chars = Array.from(line.text);
        const span = selectionSpan(state, row);
        const cursor = state.cursor.row === row ? state.cursor.col : -1;
        const cells = chars.length ? chars : [" "];
        const segments: {
          start: number;
          text: string;
          kind: "plain" | "selected" | "cursor";
          tone: Tone;
          bold: boolean;
        }[] = [];
        cells.forEach((char, col) => {
          const kind =
            col === cursor
              ? "cursor"
              : span && col >= span.start && col < span.end
                ? "selected"
                : "plain";
          const mark = line.style?.marks.find(
            (candidate) => col >= candidate.start && col < candidate.end,
          );
          const tone = mark?.tone ?? line.style?.tone ?? "fg";
          const bold = mark ? mark.bold === true : (line.style?.bold ?? false);
          const last = segments.at(-1);
          if (
            last &&
            last.kind === kind &&
            kind !== "cursor" &&
            last.tone === tone &&
            last.bold === bold
          )
            last.text += char;
          else segments.push({ start: col, text: char, kind, tone, bold });
        });
        return (
          <text
            key={`copy-row:${row}`}
            height={1}
            wrapMode="none"
            selectable={false}
            fg={foregroundProp(theme.fg)}
          >
            {segments.map((segment) =>
              segment.kind === "plain" ? (
                <span
                  key={segment.start}
                  fg={foregroundProp(toneColor(theme, segment.tone))}
                  attributes={segment.bold ? TextAttributes.BOLD : 0}
                >
                  {segment.text}
                </span>
              ) : (
                <span key={segment.start} {...copyStyle(theme, segment.kind)}>
                  {segment.text}
                </span>
              ),
            )}
          </text>
        );
      })}
      {state.search ? (
        <text
          id="copy-search"
          height={1}
          wrapMode="none"
          fg={foregroundProp(theme.accent)}
        >
          {state.search.dir === 1 ? "/" : "?"}
          {state.search.query}▌
        </text>
      ) : null}
    </box>
  );
}
