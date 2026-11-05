import { useContext, useEffect, useMemo } from "react";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import { useStore } from "../use-store.js";
import type { Indicator } from "./attention.js";
import { createWorkingIndicator } from "./working-indicator.js";
export function WorkingIndicator({
  showElapsed = false,
  startedAt,
}: {
  showElapsed?: boolean;
  startedAt?: number;
}) {
  const indicator = useMemo(
    () => createWorkingIndicator(startedAt),
    [startedAt],
  );
  useEffect(() => indicator.start(), [indicator]);
  return (
    <span>
      {useStore(indicator)} Working…
      {showElapsed ? ` ${indicator.elapsed()}` : ""}
    </span>
  );
}
export function Spinner({ color }: { color: string }) {
  const indicator = useMemo(() => createWorkingIndicator(), []);
  useEffect(() => indicator.start(), [indicator]);
  return <span fg={foregroundProp(color)}>{useStore(indicator)}</span>;
}
export function StatusGlyph({
  indicator,
  idle,
}: {
  indicator: Indicator;
  idle: string;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { status } = context.theme;
  switch (indicator.kind) {
    case "question":
      return <span fg={foregroundProp(status.question)}>?</span>;
    case "permission":
      return <span fg={foregroundProp(status.attention)}>!</span>;
    case "working":
      return <Spinner color={status.running} />;
    case "unread":
      return (
        <span
          fg={foregroundProp(
            indicator.reason === "error" ? status.error : status.attention,
          )}
        >
          ●
        </span>
      );
    case "none":
      return <span>{idle}</span>;
  }
}
