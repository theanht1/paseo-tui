import { useContext } from "react";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import {
  type ArchivedWorkspace,
  archivedCalloutText,
  type UnarchiveState,
  workspaceCallout,
} from "./archived-views.js";

/** Stands in for the prompt on an archived agent; click or `u` unarchives (restoring an archived workspace first). */
export function ArchivedCallout({
  state,
  workspace,
  onUnarchive,
}: {
  state: UnarchiveState;
  workspace: ArchivedWorkspace | undefined;
  onUnarchive(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const copy = workspace
    ? workspaceCallout(workspace, state)
    : {
        title: undefined,
        lines: [archivedCalloutText(state)],
        error: state.kind === "failed",
      };
  const actionable =
    state.kind !== "pending" &&
    workspace?.kind !== "checking" &&
    workspace?.kind !== "unavailable";
  return (
    <box
      id="archived-callout"
      flexShrink={0}
      border
      borderColor={foregroundProp(theme.border)}
      {...(copy.title ? { title: copy.title } : {})}
      onMouseDown={(event) => {
        if (event.button === 0 && actionable) onUnarchive();
      }}
    >
      {copy.lines.map((line, index) => (
        <text
          key={line}
          wrapMode={workspace ? "word" : "none"}
          {...(workspace ? {} : { height: 1 })}
          fg={foregroundProp(
            copy.error && index === copy.lines.length - 1
              ? theme.error
              : theme.muted,
          )}
        >
          {line}
        </text>
      ))}
    </box>
  );
}
