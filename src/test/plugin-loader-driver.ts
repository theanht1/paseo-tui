/** Child process of plugin-loader.test.ts: loads plugins for real and prints what it saw. */
import * as opentui from "@opentui/react";
import * as react from "react";
import * as api from "../plugin.js";
import { loadPlugins } from "../plugin-loader.js";
import { createTheme } from "../ui/render/theme.js";

const [configDir = "", ...specifiers] = process.argv.slice(2);
const { plugins, errors } = await loadPlugins(specifiers, configDir);
const probes: Record<string, Record<string, boolean>> = {};
for (const plugin of plugins)
  await plugin.activate({
    host: { serverId: "srv", label: "local" },
    rpc: async () => null,
    registerView: () => () => {},
    registerAction: () => () => {},
    openView() {},
    focusWorkspace() {},
    // The fixture hands back what its own imports resolved to.
    notify() {},
    theme: createTheme({}),
    onDispose(report) {
      report();
    },
  });
const seen: unknown = Reflect.get(globalThis, "__pluginProbe");
if (typeof seen === "object" && seen !== null)
  for (const [id, probe] of Object.entries(seen))
    probes[id] = {
      react: probe.createElement === react.createElement,
      opentui: probe.useKeyboard === opentui.useKeyboard,
      api: probe.useViewKeyboard === api.useViewKeyboard,
    };
process.stdout.write(
  JSON.stringify({ ids: plugins.map((plugin) => plugin.id), errors, probes }),
);
