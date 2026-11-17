import { TUI_PLUGIN_API_VERSION, type TuiPlugin } from "./api.js";

/** Validates an imported plugin module; throws what is wrong with it. */
export function parsePluginModule(module: unknown): TuiPlugin {
  const plugin =
    typeof module === "object" && module !== null && "default" in module
      ? module.default
      : undefined;
  if (typeof plugin !== "object" || plugin === null)
    throw Error("has no default export; export default defineTuiPlugin({ … })");
  const id = "id" in plugin ? plugin.id : undefined;
  if (typeof id !== "string" || !/^\S+$/.test(id))
    throw Error("needs a non-empty string id");
  const version = "apiVersion" in plugin ? plugin.apiVersion : undefined;
  if (version !== TUI_PLUGIN_API_VERSION)
    throw Error(
      `uses plugin API version ${String(version)}; this paseo-tui supports version ${TUI_PLUGIN_API_VERSION}. Update the plugin or paseo-tui`,
    );
  const activate = "activate" in plugin ? plugin.activate : undefined;
  if (typeof activate !== "function")
    throw Error("needs an activate(ctx) function");
  return {
    id,
    apiVersion: version,
    async activate(context) {
      await activate.call(plugin, context);
    },
  };
}
