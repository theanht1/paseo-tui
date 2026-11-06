import { useContext } from "react";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import type { QueueRow } from "./queue-view.js";

/** Messages waiting for the running turn to end, above the prompt. */
export function QueuedMessages({
  rows,
  more,
  hint,
}: {
  rows: readonly QueueRow[];
  more: number;
  hint: string;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box id="queued-messages" flexDirection="column" flexShrink={0}>
      {rows.map((row) => (
        <text
          key={row.id}
          height={1}
          wrapMode="none"
          truncate
          fg={foregroundProp(row.selected ? theme.accent : theme.muted)}
          bg={row.selected ? backgroundProp(theme.selectionBg) : undefined}
        >
          {row.label}
        </text>
      ))}
      {more ? (
        <text height={1} fg={foregroundProp(theme.muted)}>
          {`  +${more} more`}
        </text>
      ) : null}
      <text height={1} wrapMode="none" fg={foregroundProp(theme.faint)}>
        {hint}
      </text>
    </box>
  );
}
