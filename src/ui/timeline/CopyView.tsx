import { TextAttributes } from "@opentui/core";
import { useContext } from "react";
import { type CopyState, selectionSpan } from "../copy/copy-mode.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "../render/theme.js";

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
export function CopyView({ state }: { state: CopyState }) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const rows = state.lines.slice(state.top, state.top + state.pageSize);
  return (
    <box id="copy-mode" flexDirection="column" flexGrow={1} minHeight={1}>
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
        }[] = [];
        cells.forEach((char, col) => {
          const kind =
            col === cursor
              ? "cursor"
              : span && col >= span.start && col < span.end
                ? "selected"
                : "plain";
          const last = segments.at(-1);
          if (last && last.kind === kind && kind !== "cursor")
            last.text += char;
          else segments.push({ start: col, text: char, kind });
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
                segment.text
              ) : (
                <span key={segment.start} {...copyStyle(theme, segment.kind)}>
                  {segment.text}
                </span>
              ),
            )}
          </text>
        );
      })}
    </box>
  );
}
