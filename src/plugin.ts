/** The `paseo-tui/plugin` entry: what a TUI plugin module imports. */
export {
  defineTuiPlugin,
  TUI_PLUGIN_API_VERSION,
  type TuiPlugin,
  type TuiPluginAction,
  type TuiPluginContext,
  type TuiPluginNoticeLevel,
  type TuiPluginView,
  type TuiPluginViewProps,
} from "./ui/plugins/api.js";
export { useViewKeyboard } from "./ui/plugins/view-keyboard.js";
export type { Theme } from "./ui/render/theme.js";
