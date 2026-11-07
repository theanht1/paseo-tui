import { useTerminalDimensions } from "@opentui/react";
import { useContext } from "react";
import { Spinner } from "../agent/WorkingIndicator.js";
import { useKeyOwner } from "../input/key-router.js";
import { listWindow, useListCursor } from "../input/list-keys.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "../render/theme.js";
import type { SubagentPopupRow } from "./subagent-popup.js";
import { BUCKET_LABEL, type SubagentBucket } from "./subagents.js";

function BucketGlyph({
  bucket,
  theme,
}: {
  bucket: SubagentBucket;
  theme: Theme;
}) {
  switch (bucket) {
    case "running":
      return <Spinner color={theme.status.running} />;
    case "needs_input":
      return <span fg={foregroundProp(theme.status.attention)}>!</span>;
    case "failed":
      return <span fg={foregroundProp(theme.status.error)}>✕</span>;
    case "attention":
      return <span fg={foregroundProp(theme.status.attention)}>●</span>;
    case "done":
      return <span fg={foregroundProp(theme.status.idle)}>✓</span>;
  }
}
export function SubagentPopup({
  rows,
  onSelect,
  onClose,
}: {
  rows: readonly SubagentPopupRow[];
  onSelect(row: SubagentPopupRow): void;
  onClose(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const { width, height } = useTerminalDimensions();
  const boxHeight = Math.min(height, rows.length + 2);
  const visible = Math.max(1, boxHeight - 2);
  const list = useListCursor(rows.length, visible);
  const cursor = list.cursor;
  useKeyOwner(true, (stroke) => {
    if (list.key(stroke)) return true;
    if (stroke.name === "return") {
      const row = rows[list.current()];
      if (row) onSelect(row);
    } else if (
      stroke.name === "escape" ||
      stroke.name === "q" ||
      (stroke.ctrl && stroke.name === "c")
    )
      onClose();
    else return false;
    return true;
  });
  const boxWidth = Math.min(72, Math.max(20, width - 4));
  const start = listWindow(cursor, rows.length, visible);
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={20}
      onMouseDown={onClose}
    >
      <box
        id="subagent-popup"
        position="absolute"
        left={Math.floor((width - boxWidth) / 2)}
        top={Math.max(0, Math.floor((height - boxHeight) / 2))}
        width={boxWidth}
        height={boxHeight}
        border
        title="Subagents · j/k gg/G ^d/^u Enter Esc"
        borderColor={foregroundProp(theme.borderFocused)}
        backgroundColor={backgroundProp(theme.codeBg)}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {rows.slice(start, start + visible).map((row, offset) => {
          const index = start + offset;
          return (
            <box
              key={row.key}
              id={`subagent-row:${index}`}
              height={1}
              flexDirection="row"
              backgroundColor={backgroundProp(
                index === cursor ? theme.selectionBg : theme.codeBg,
              )}
              onMouseDown={(event) => {
                event.stopPropagation();
                onSelect(row);
              }}
            >
              <text
                flexGrow={1}
                minWidth={0}
                wrapMode="none"
                fg={foregroundProp(theme.fg)}
              >
                {index === cursor ? "› " : "  "}
                {row.kind === "parent" ? (
                  <span fg={foregroundProp(theme.accent)}>↑</span>
                ) : (
                  <BucketGlyph bucket={row.bucket} theme={theme} />
                )}{" "}
                {row.label}
                {row.kind === "subagent" && row.subtitle ? (
                  <span
                    fg={foregroundProp(theme.muted)}
                  >{`  ${row.subtitle}`}</span>
                ) : null}
              </text>
              {row.kind === "subagent" ? (
                <text flexShrink={0} fg={foregroundProp(theme.faint)}>
                  {` ${BUCKET_LABEL[row.bucket]} `}
                </text>
              ) : null}
            </box>
          );
        })}
      </box>
    </box>
  );
}
