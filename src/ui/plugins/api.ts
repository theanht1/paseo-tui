import type { ReactNode } from "react";
import type { Theme } from "../render/theme.js";

/** The plugin API this paseo-tui implements; modules declaring another are refused. */
export const TUI_PLUGIN_API_VERSION = 1;

export interface TuiPluginViewProps {
  /** The view has the keyboard: its tab is selected and in input mode (`i`, left with Ctrl-]). */
  focused: boolean;
}
export interface TuiPluginView {
  /** Unique within the plugin; saved layouts refer to it. */
  id: string;
  /** The tab title. */
  title: string;
  /** A React function component over OpenTUI elements; once shown it stays mounted behind other tabs. */
  render(props: TuiPluginViewProps): ReactNode;
}
export interface TuiPluginAction {
  /** Unique within the plugin; `keys` rebinds it as `plugin.<pluginId>.<id>`. */
  id: string;
  /** The Command Center and help title. */
  title: string;
  run(): void | Promise<void>;
  /** Normal-mode keys, in the `keys` config format (e.g. `Ctrl-y`). */
  defaultKeys?: readonly string[];
}
export type TuiPluginNoticeLevel = "info" | "error";
/** What a plugin gets for one connected host that runs its server plugin. */
export interface TuiPluginContext {
  host: {
    /** The daemon's `server_info.serverId`. */
    serverId: string;
    label: string;
  };
  /** Calls this plugin's server RPC on this host; validate the output. */
  rpc(method: string, input?: unknown): Promise<unknown>;
  /** Adds a view that opens as a workspace tab; returns its disposer. */
  registerView(view: TuiPluginView): () => void;
  /** Adds a Command Center action; returns its disposer. */
  registerAction(action: TuiPluginAction): () => void;
  /** Opens (or selects) a registered view's tab and gives it the keyboard. */
  openView(viewId: string): void;
  focusWorkspace(workspaceId: string): void;
  /** Shows a status message; an `error` is marked `!` and stays longer. */
  notify(message: string, level?: TuiPluginNoticeLevel): void;
  theme: Readonly<Theme>;
  /** Runs when the host disconnects or the server plugin is disabled or removed. */
  onDispose(dispose: () => void): void;
}
export interface TuiPlugin {
  /** The id of the Paseo server plugin this pairs with. */
  id: string;
  apiVersion: typeof TUI_PLUGIN_API_VERSION;
  activate(context: TuiPluginContext): void | Promise<void>;
}
export function defineTuiPlugin(plugin: TuiPlugin): TuiPlugin {
  return plugin;
}
