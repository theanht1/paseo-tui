import type { ConnectionState } from "@getpaseo/client";
import { useTerminalDimensions } from "@opentui/react";
import { useContext } from "react";
import type { TimelineSnapshot, TurnState } from "../state/timeline-store.js";
import type { UsageSnapshot } from "../state/usage-store.js";
import { BINDINGS } from "./input/bindings.js";
import type { Binding, Context, Mode } from "./input/keymap.js";
import { foregroundProp, type Theme, ThemeContext } from "./render/theme.js";
import { statusLine, truncateCells } from "./status-hints.js";
import { usageMeters } from "./usage/usage-meters.js";
import { type ExternalStore, useStore } from "./use-store.js";

const NO_USAGE_SNAPSHOT: UsageSnapshot = { kind: "ready", reports: [] };
const NO_USAGE: ExternalStore<UsageSnapshot> = {
  subscribe: () => () => {},
  getSnapshot: () => NO_USAGE_SNAPSHOT,
};

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
export interface StatusBarProps {
  label: string;
  connection: ExternalStore<ConnectionState>;
  timeline: ExternalStore<TimelineSnapshot> | null;
  mode: Mode;
  context: Context;
  searchStatus?: string;
  terminalInput?: boolean;
  /** Provider usage meters; absent when the daemon reports no usage. */
  usage?: ExternalStore<UsageSnapshot>;
  onHelp?(): void;
  bindings?: readonly Binding[];
}

export function StatusBar({
  label,
  connection,
  timeline,
  mode,
  context,
  searchStatus,
  terminalInput = false,
  usage = NO_USAGE,
  onHelp,
  bindings = BINDINGS,
}: StatusBarProps) {
  const contextValue = useContext(ThemeContext);
  if (!contextValue) throw new Error("ThemeContext required");
  const { theme } = contextValue;
  const state = connectionText(useStore(connection), theme);
  const { width } = useTerminalDimensions();
  const hints = bindings
    .filter(
      (b) =>
        b.modes.includes(mode.kind) && (!b.context || b.context === context),
    )
    .map((b) => `${b.keys} ${b.description}`);
  const usageSnapshot = useStore(usage);
  const meters =
    usageSnapshot.kind === "loading"
      ? ""
      : usageMeters(usageSnapshot.reports, Date.now());
  const prefix = `${terminalInput ? "Terminal input · Ctrl-] TUI shortcuts · " : ""}${label} ${state.text} ${mode.kind === "search" ? `/${mode.query}` : mode.kind.toUpperCase()}`;
  const suffix = meters ? ` · ${meters}` : "";
  return timeline ? (
    <TimelineStatus
      store={timeline}
      width={width}
      prefix={prefix}
      suffix={suffix}
      hints={hints}
      searchStatus={searchStatus ?? ""}
      onHelp={onHelp}
    />
  ) : (
    <StatusText
      width={width}
      prefix={`${prefix}${suffix}`}
      hints={hints}
      onHelp={onHelp}
    />
  );
}
function TimelineStatus({
  store,
  prefix,
  suffix,
  searchStatus,
  ...rest
}: {
  store: ExternalStore<TimelineSnapshot>;
  prefix: string;
  suffix: string;
  searchStatus: string;
  width: number;
  hints: readonly string[];
  onHelp?: () => void;
}) {
  const { turn } = useStore(store);
  return (
    <StatusText
      {...rest}
      prefix={`${prefix} · turn ${turnText(turn)}${searchStatus ? ` · ${searchStatus}` : ""}${suffix}`}
    />
  );
}
function StatusText({
  width,
  prefix,
  hints,
  onHelp,
}: {
  width: number;
  prefix: string;
  hints: readonly string[];
  onHelp?: () => void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const line = statusLine(width, prefix, hints);
  const head = truncateCells(prefix, Math.max(0, width - 14));
  return (
    <box height={1} flexShrink={0} flexDirection="row">
      <text wrapMode="none" fg={foregroundProp(context.theme.fg)}>
        {head}
      </text>
      <text wrapMode="none" fg={foregroundProp(context.theme.muted)}>
        {line.slice(head.length, -11)}
      </text>
      <text
        id="status-shortcuts"
        wrapMode="none"
        flexShrink={0}
        fg={foregroundProp(context.theme.accent)}
        onMouseDown={onHelp}
      >
        ? shortcuts
      </text>
    </box>
  );
}
