import type { ConnectionState } from "@getpaseo/client";
import { useContext } from "react";
import type { TimelineSnapshot, TurnState } from "../state/timeline-store.js";
import { BINDINGS, type Context, type Mode } from "./input/keymap.js";
import {
  backgroundProp,
  foregroundProp,
  type Theme,
  ThemeContext,
} from "./render/theme.js";
import { type ExternalStore, useStore } from "./use-store.js";

function connectionText(
  state: ConnectionState,
  theme: Theme,
): {
  text: string;
  color: string;
} {
  switch (state.status) {
    case "connected":
      return { text: "connected", color: theme.success };
    case "connecting":
      return {
        text: `reconnecting (attempt ${state.attempt})`,
        color: theme.warn,
      };
    // Reconnect is always enabled once the TUI is running, so a dropped
    // socket reports "disconnected" while the client waits to retry.
    case "disconnected":
      return { text: "reconnecting", color: theme.warn };
    case "idle":
    case "disposed":
      return { text: "disconnected", color: theme.error };
  }
}
function turnText(turn: TurnState): string {
  switch (turn.kind) {
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "failed":
      return `failed: ${turn.message}`;
  }
}
function TurnLabel({
  store,
  theme,
}: {
  store: ExternalStore<TimelineSnapshot>;
  theme: Theme;
}) {
  const { turn } = useStore(store);
  return (
    <span fg={foregroundProp(turn.kind === "failed" ? theme.error : theme.fg)}>
      {" · turn "}
      {turnText(turn)}
    </span>
  );
}

export interface StatusBarProps {
  label: string;
  connection: ExternalStore<ConnectionState>;
  timeline: ExternalStore<TimelineSnapshot> | null;
  mode: Mode;
  context: Context;
  searchStatus?: string;
}

export function StatusBar({
  label,
  connection,
  timeline,
  mode,
  context,
  searchStatus,
}: StatusBarProps) {
  const contextValue = useContext(ThemeContext);
  if (!contextValue) throw new Error("ThemeContext required");
  const { theme } = contextValue;
  const state = connectionText(useStore(connection), theme);
  const hints = BINDINGS.filter(
    (b) => b.modes.includes(mode.kind) && (!b.context || b.context === context),
  )
    .sort((a, b) => Number(Boolean(b.context)) - Number(Boolean(a.context)))
    .map((b) => `${b.keys} ${b.description}`)
    .join(" · ");
  return (
    <box height={1} flexShrink={0} flexDirection="row" gap={1}>
      <text wrapMode="none" flexShrink={0} fg={foregroundProp(theme.fg)}>
        {label} <span fg={foregroundProp(state.color)}>{state.text}</span>
      </text>
      <text
        flexShrink={0}
        bg={backgroundProp(theme.selectionBg)}
        fg={foregroundProp(theme.accent)}
      >
        {mode.kind === "search" ? `/${mode.query}` : mode.kind.toUpperCase()}
      </text>
      <text
        wrapMode="none"
        flexGrow={1}
        minWidth={0}
        fg={foregroundProp(theme.muted)}
      >
        {timeline ? <TurnLabel store={timeline} theme={theme} /> : null} ·{" "}
        {searchStatus} {hints}
      </text>
    </box>
  );
}
