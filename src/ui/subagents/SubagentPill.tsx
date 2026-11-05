import { useContext } from "react";
import { Spinner } from "../agent/WorkingIndicator.js";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import type { PaneSubagents } from "./subagent-popup.js";

/** One line above the chat input: parent breadcrumb and the subagent summary; click or `s` opens the list. */
export function SubagentPill({
  view,
  onOpen,
}: {
  view: PaneSubagents;
  onOpen(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box
      id="subagent-pill"
      height={1}
      flexShrink={0}
      flexDirection="row"
      onMouseDown={(event) => {
        if (event.button === 0) onOpen();
      }}
    >
      <text wrapMode="none" fg={foregroundProp(theme.accent)}>
        {view.parent ? `↑ ${view.parent.label}` : ""}
        {view.parent && view.entries.length ? "  " : ""}
        {view.pill.running ? <Spinner color={theme.status.running} /> : null}
        {view.pill.running ? " " : ""}
        {view.entries.length ? view.pill.text : ""}
        <span fg={foregroundProp(theme.faint)}> (s)</span>
      </text>
    </box>
  );
}
