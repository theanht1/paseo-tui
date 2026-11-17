import { expect, test } from "vitest";
import { createPluginAdapter, type PluginDaemon } from "./daemon-adapter.js";

function fakeDaemon(features: {
  plugins?: boolean;
  pluginManagement?: boolean;
}) {
  const calls: unknown[][] = [];
  const observed: {
    update?: (message: { type: string; payload?: unknown }) => void;
  } = {};
  let released = 0;
  const daemon: PluginDaemon = {
    getLastServerInfoMessage: () => ({ serverId: "srv-1", features }),
    async listPlugins() {
      calls.push(["list"]);
      return [
        { id: "board", enabled: true, status: "running" },
        { id: "off", enabled: false, status: "disabled" },
        { id: "broken", enabled: true, status: "failed" },
      ];
    },
    async invokePluginRpc(pluginId, method, input) {
      calls.push(["rpc", pluginId, method, input]);
      return { ok: true };
    },
    observeEvents(events) {
      calls.push(["observe", events]);
      return {
        subscribe(observer) {
          observed.update = observer.update;
          return () => {
            delete observed.update;
          };
        },
        async release() {
          released++;
        },
      };
    },
  };
  return { daemon, calls, observed, released: () => released };
}

test("plugins need the daemon's plugin features", () => {
  expect(createPluginAdapter(fakeDaemon({}).daemon)).toBeNull();
  expect(createPluginAdapter(fakeDaemon({ plugins: true }).daemon)).toBeNull();
});

test("lists server plugins, invokes their RPC and reports catalog changes", async () => {
  const fake = fakeDaemon({ plugins: true, pluginManagement: true });
  const port = createPluginAdapter(fake.daemon);
  if (!port) throw Error("Expected plugin support");
  expect(port.serverId).toBe("srv-1");
  expect(await port.list()).toEqual([
    { id: "board", running: true },
    { id: "off", running: false },
    { id: "broken", running: false },
  ]);
  expect(await port.rpc("board", "board.snapshot", { a: 1 })).toEqual({
    ok: true,
  });
  let changes = 0;
  const stop = port.observe(() => changes++);
  fake.observed.update?.({
    type: "status",
    payload: { status: "plugin_catalog_changed", pluginId: "board" },
  });
  fake.observed.update?.({ type: "status", payload: { status: "other" } });
  fake.observed.update?.({ type: "agent_update" });
  expect(changes).toBe(1);
  await stop();
  expect(fake.released()).toBe(1);
  expect(fake.observed.update).toBeUndefined();
  expect(fake.calls).toEqual([
    ["list"],
    ["rpc", "board", "board.snapshot", { a: 1 }],
    ["observe", ["status.plugin_catalog_changed"]],
  ]);
});
