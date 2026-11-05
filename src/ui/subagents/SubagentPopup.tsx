import { useTerminalDimensions } from "@opentui/react";
import { useContext, useRef, useState } from "react";
import { Spinner } from "../agent/WorkingIndicator.js";
import { useKeyOwner } from "../input/key-router.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "../render/theme.js";
import { moveCursor, type SubagentPopupRow } from "./subagent-popup.js";
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
  const [cursor, setCursor] = useState(0);
  const latest = useRef(0);
  useKeyOwner(true, (stroke) => {
    const delta =
      stroke.name === "down" ||
      stroke.name === "j" ||
      (stroke.ctrl && stroke.name === "n")
        ? 1
        : stroke.name === "up" ||
            stroke.name === "k" ||
            (stroke.ctrl && stroke.name === "p")
          ? -1
          : 0;
    if (delta) {
      latest.current = moveCursor(latest.current, delta, rows.length);
      setCursor(latest.current);
    } else if (stroke.name === "return") {
      const row = rows[latest.current];
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
  const boxHeight = Math.min(height, rows.length + 2);
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
        title="Subagents · j/k Enter Esc"
        borderColor={foregroundProp(theme.borderFocused)}
        backgroundColor={backgroundProp(theme.codeBg)}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {rows.map((row, index) => (
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
        ))}
      </box>
    </box>
  );
}
