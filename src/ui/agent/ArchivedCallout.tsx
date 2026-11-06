import { useContext } from "react";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import { archivedCalloutText, type UnarchiveState } from "./archived-views.js";

/** Stands in for the prompt on an archived agent; click or `u` unarchives. */
export function ArchivedCallout({
  state,
  onUnarchive,
}: {
  state: UnarchiveState;
  onUnarchive(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box
      id="archived-callout"
      flexShrink={0}
      border
      borderColor={foregroundProp(theme.border)}
      onMouseDown={(event) => {
        if (event.button === 0 && state.kind !== "pending") onUnarchive();
      }}
    >
      <text
        height={1}
        wrapMode="none"
        fg={foregroundProp(state.kind === "failed" ? theme.error : theme.muted)}
      >
        {archivedCalloutText(state)}
      </text>
    </box>
  );
}
