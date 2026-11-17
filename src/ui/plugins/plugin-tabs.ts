import type { CommandItem } from "../command-center/registry.js";
import type { PluginViewTab } from "../workspace/workspaces.js";
import type { TuiPluginNoticeLevel } from "./api.js";
import type {
  PluginActionEntry,
  PluginHostSnapshot,
  PluginViewEntry,
} from "./plugin-host.js";

/** A plugin view the user opened as a tab of a workspace. */
export interface OpenPluginView {
  workspaceId: string;
  pluginId: string;
  viewId: string;
}
type HostOf = (workspaceId: string) => string | null;

export function pluginViewKey(open: OpenPluginView): string {
  return `plugin:${open.workspaceId}:${open.pluginId}:${open.viewId}`;
}
/** The registered view behind an open one: its plugin's, on the workspace's host. */
export function registeredView(
  open: OpenPluginView,
  views: readonly PluginViewEntry[],
  hostOf: HostOf,
): PluginViewEntry | null {
  const hostId = hostOf(open.workspaceId);
  return (
    views.find(
      (entry) =>
        entry.hostId === hostId &&
        entry.pluginId === open.pluginId &&
        entry.view.id === open.viewId,
    ) ?? null
  );
}
/** The tabs of the open views whose plugin is active on their workspace's host. */
export function pluginViewTabs(
  open: readonly OpenPluginView[],
  views: readonly PluginViewEntry[],
  hostOf: HostOf,
): PluginViewTab[] {
  return open.flatMap((entry): PluginViewTab[] => {
    const registered = registeredView(entry, views, hostOf);
    return registered
      ? [
          {
            kind: "plugin",
            key: pluginViewKey(entry),
            ...entry,
            title: registered.view.title,
          },
        ]
      : [];
  });
}
/**
 * Forgets open views whose host finished starting its plugins without them (the
 * plugin was disabled or removed), like panes of vanished agents. Views of a
 * host that is offline or still starting stay; unchanged input is returned as is.
 */
export function prunePluginViews(
  open: readonly OpenPluginView[],
  snapshot: Pick<PluginHostSnapshot, "views" | "settled">,
  hostOf: HostOf,
): readonly OpenPluginView[] {
  const kept = open.filter((entry) => {
    const hostId = hostOf(entry.workspaceId);
    return (
      hostId === null ||
      !snapshot.settled.has(hostId) ||
      registeredView(entry, snapshot.views, hostOf) !== null
    );
  });
  return kept.length === open.length ? open : kept;
}
/** The action a key runs: the given host's, else the first host's that offers it. */
export function actionOnHost(
  actions: readonly PluginActionEntry[],
  pluginId: string,
  actionId: string,
  hostId: string | null,
): PluginActionEntry | null {
  const offered = actions.filter(
    (entry) => entry.pluginId === pluginId && entry.action.id === actionId,
  );
  return offered.find((entry) => entry.hostId === hostId) ?? offered[0] ?? null;
}
/** Command Center entries for the registered actions, one per host offering each. */
export function pluginCommands(
  actions: readonly PluginActionEntry[],
  run: (entry: PluginActionEntry) => void,
): CommandItem[] {
  return actions.map((entry) => {
    const shared = actions.some(
      (other) =>
        other !== entry &&
        other.pluginId === entry.pluginId &&
        other.action.id === entry.action.id,
    );
    return {
      id: `plugin:${entry.hostId}:${entry.pluginId}:${entry.action.id}`,
      group: "Actions",
      title: entry.action.title,
      ...(shared ? { subtitle: entry.hostLabel } : {}),
      keywords: [entry.pluginId],
      action: {
        type: "plugin",
        plugin: entry.pluginId,
        action: entry.action.id,
      },
      run(): undefined {
        run(entry);
      },
    };
  });
}
/** The status line for plugin messages that arrived together, and how long it stays (ms). */
export function pluginNoticeLine(
  messages: readonly { text: string; level: TuiPluginNoticeLevel }[],
): { text: string; hold: number } {
  const text = messages.map((message) => message.text).join(" · ");
  return messages.some((message) => message.level === "error")
    ? { text: `! ${text}`, hold: 5000 }
    : { text, hold: 2500 };
}
