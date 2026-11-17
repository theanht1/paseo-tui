import { expect, test } from "vitest";
import { createTheme } from "../render/theme.js";
import type { TuiPluginContext } from "./api.js";
import { parsePluginModule } from "./plugin-module.js";

const context: TuiPluginContext = {
  host: { serverId: "srv", label: "local" },
  rpc: async () => null,
  registerView: () => () => {},
  registerAction: () => () => {},
  openView() {},
  focusWorkspace() {},
  notify() {},
  theme: createTheme({}),
  onDispose() {},
};

test("accepts a module whose default export is a plugin", async () => {
  const seen: unknown[] = [];
  const plugin = parsePluginModule({
    default: {
      id: "board",
      apiVersion: 1,
      async activate(this: { id: string }, ctx: unknown) {
        seen.push(this.id, ctx);
      },
    },
  });
  expect(plugin.id).toBe("board");
  expect(plugin.apiVersion).toBe(1);
  await plugin.activate(context);
  expect(seen).toEqual(["board", context]);
});

test.each([
  [{}, "has no default export; export default defineTuiPlugin({ … })"],
  [
    { default: 3 },
    "has no default export; export default defineTuiPlugin({ … })",
  ],
  [
    { default: { apiVersion: 1, activate() {} } },
    "needs a non-empty string id",
  ],
  [
    { default: { id: "a b", apiVersion: 1, activate() {} } },
    "needs a non-empty string id",
  ],
  [
    { default: { id: "board", apiVersion: 2, activate() {} } },
    "uses plugin API version 2; this paseo-tui supports version 1. Update the plugin or paseo-tui",
  ],
  [
    { default: { id: "board", activate() {} } },
    "uses plugin API version undefined; this paseo-tui supports version 1. Update the plugin or paseo-tui",
  ],
  [
    { default: { id: "board", apiVersion: 1 } },
    "needs an activate(ctx) function",
  ],
])("refuses %j", (module, message) => {
  expect(() => parsePluginModule(module)).toThrow(message);
});
