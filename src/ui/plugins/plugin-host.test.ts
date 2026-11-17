import { expect, test } from "vitest";
import { createEmitter } from "../../state/emitter.js";
import type { ServerPluginsSnapshot } from "../../state/server-plugins.js";
import { createTheme } from "../render/theme.js";
import {
  defineTuiPlugin,
  type TuiPlugin,
  type TuiPluginContext,
} from "./api.js";
import {
  createPluginHost,
  type PluginHostEntry,
  type PluginHostUi,
} from "./plugin-host.js";

const theme = createTheme({}, {});
function server(serverId: string) {
  const calls: unknown[][] = [];
  return {
    serverId,
    calls,
    async rpc(pluginId: string, method: string, input: unknown) {
      calls.push([pluginId, method, input]);
      return { pong: serverId };
    },
  };
}
function running(...ids: string[]): ServerPluginsSnapshot {
  return { kind: "ready", running: new Set(ids) };
}
function fakeHosts(initial: PluginHostEntry[]) {
  const emitter = createEmitter();
  let entries: readonly PluginHostEntry[] = initial;
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => entries,
    set(next: PluginHostEntry[]) {
      entries = next;
      emitter.notify();
    },
  };
}
function fakeUi() {
  const events: unknown[][] = [];
  const ui: PluginHostUi = {
    openView: (target) => events.push(["open", target]),
    focusWorkspace: (id) => events.push(["focus", id]),
    notify: (text, level) => events.push(["notify", text, level]),
  };
  return { ui, events };
}
function board(log: unknown[][] = []) {
  const contexts: TuiPluginContext[] = [];
  const plugin = defineTuiPlugin({
    id: "board",
    apiVersion: 1,
    activate(ctx) {
      contexts.push(ctx);
      ctx.registerView({ id: "main", title: "Board", render: () => null });
      ctx.registerAction({
        id: "refresh",
        title: "Refresh board",
        defaultKeys: ["Ctrl-y"],
        async run() {
          log.push(["ran", await ctx.rpc("board.snapshot", { n: 1 })]);
        },
      });
      ctx.onDispose(() => log.push(["disposed", ctx.host.label]));
    },
  });
  return { plugin, contexts };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("activates once per host that runs the server plugin", async () => {
  const one = server("srv-1");
  const two = server("srv-2");
  const log: unknown[][] = [];
  const { plugin, contexts } = board(log);
  const hosts = fakeHosts([
    { id: "a", label: "alpha", server: one, state: running("board") },
    { id: "b", label: "beta", server: two, state: running("other") },
    { id: "c", label: "gamma", server: null, state: { kind: "offline" } },
  ]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  await tick();
  const snapshot = host.getSnapshot();
  expect(snapshot.views.map((v) => [v.hostId, v.pluginId, v.view.id])).toEqual([
    ["a", "board", "main"],
  ]);
  expect(snapshot.actions.map((a) => [a.hostId, a.action.title])).toEqual([
    ["a", "Refresh board"],
  ]);
  expect([...snapshot.settled]).toEqual(["a", "b", "c"]);
  expect(contexts[0]?.host).toEqual({ serverId: "srv-1", label: "alpha" });
  expect(Object.isFrozen(contexts[0]?.theme)).toBe(true);
  const action = snapshot.actions[0];
  if (!action) throw Error("Expected an action");
  await host.run(action);
  expect(one.calls).toEqual([["board", "board.snapshot", { n: 1 }]]);
  expect(two.calls).toEqual([]);
  expect(log).toEqual([["ran", { pong: "srv-1" }]]);
  // Nothing changed: the same snapshot object.
  hosts.set([...hosts.getSnapshot()]);
  expect(host.getSnapshot()).toBe(snapshot);
  expect(contexts).toHaveLength(1);
});

test("disposes when the plugin stops, the host goes offline or its connection is replaced", async () => {
  const one = server("srv-1");
  const log: unknown[][] = [];
  const { plugin, contexts } = board(log);
  const entry: PluginHostEntry = {
    id: "a",
    label: "alpha",
    server: one,
    state: running("board"),
  };
  const hosts = fakeHosts([entry]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  await tick();
  hosts.set([{ ...entry, state: running() }]);
  expect(host.getSnapshot().views).toEqual([]);
  expect(host.getSnapshot().actions).toEqual([]);
  expect(log).toEqual([["disposed", "alpha"]]);
  await expect(contexts[0]?.rpc("x")).rejects.toThrow(/no longer active/);
  expect(
    contexts[0]?.registerView({
      id: "late",
      title: "Late",
      render: () => null,
    }),
  ).toBeTypeOf("function");
  expect(host.getSnapshot().views).toEqual([]);

  hosts.set([entry]);
  await tick();
  expect(host.getSnapshot().views).toHaveLength(1);
  hosts.set([{ ...entry, state: { kind: "offline" } }]);
  expect(host.getSnapshot().views).toEqual([]);
  expect([...host.getSnapshot().settled]).toEqual([]);

  hosts.set([entry]);
  await tick();
  hosts.set([{ ...entry, server: server("srv-1") }]);
  await tick();
  expect(contexts).toHaveLength(4);
  expect(host.getSnapshot().views).toHaveLength(1);
  hosts.set([]);
  expect(host.getSnapshot().views).toEqual([]);
  expect(log.filter(([kind]) => kind === "disposed")).toHaveLength(4);
});

test("registration disposers remove one view or action", async () => {
  let removeView = () => {};
  let removeAction = () => {};
  const plugin = defineTuiPlugin({
    id: "board",
    apiVersion: 1,
    activate(ctx) {
      removeView = ctx.registerView({
        id: "v",
        title: "V",
        render: () => null,
      });
      removeAction = ctx.registerAction({ id: "a", title: "A", run() {} });
      expect(() =>
        ctx.registerView({ id: "v", title: "Again", render: () => null }),
      ).toThrow(/already registered/);
    },
  });
  const hosts = fakeHosts([
    { id: "a", label: "alpha", server: server("s"), state: running("board") },
  ]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  await tick();
  expect(host.getSnapshot().views).toHaveLength(1);
  removeView();
  expect(host.getSnapshot().views).toEqual([]);
  expect(host.getSnapshot().actions).toHaveLength(1);
  removeAction();
  expect(host.getSnapshot().actions).toEqual([]);
});

test("a plugin that throws is reported and leaves the others running", async () => {
  const good = board().plugin;
  const sync: TuiPlugin = {
    id: "sync-bad",
    apiVersion: 1,
    activate(ctx) {
      ctx.registerView({ id: "v", title: "Half", render: () => null });
      throw Error("boom");
    },
  };
  const later: TuiPlugin = {
    id: "async-bad",
    apiVersion: 1,
    async activate(ctx) {
      ctx.registerAction({
        id: "explode",
        title: "Explode",
        run() {
          throw Error("bang");
        },
      });
      ctx.onDispose(() => {
        throw Error("dispose failed");
      });
      await Promise.reject(Error("later boom"));
    },
  };
  const exploding: TuiPlugin = {
    id: "runner",
    apiVersion: 1,
    activate(ctx) {
      ctx.registerAction({
        id: "explode",
        title: "Explode",
        async run() {
          await ctx.rpc("fail");
        },
      });
    },
  };
  const failing = {
    serverId: "s",
    rpc: async (): Promise<unknown> => {
      throw Error("rpc down");
    },
  };
  const hosts = fakeHosts([
    {
      id: "a",
      label: "alpha",
      server: failing,
      state: running("board", "sync-bad", "async-bad", "runner"),
    },
  ]);
  const host = createPluginHost({
    plugins: [sync, later, good, exploding],
    theme,
    hosts,
  });
  await tick();
  const { ui, events } = fakeUi();
  host.connect(ui);
  expect(events).toEqual([
    ["notify", "Plugin sync-bad failed on alpha: boom", "error"],
    ["notify", "Plugin async-bad failed on alpha: later boom", "error"],
    ["notify", "Plugin async-bad failed on alpha: dispose failed", "error"],
  ]);
  const snapshot = host.getSnapshot();
  expect(snapshot.views.map((v) => v.pluginId)).toEqual(["board"]);
  expect(snapshot.actions.map((a) => a.pluginId)).toEqual(["board", "runner"]);
  expect([...snapshot.settled]).toEqual(["a"]);
  const runner = snapshot.actions[1];
  if (!runner) throw Error("Expected the runner action");
  await host.run(runner);
  expect(events.at(-1)).toEqual([
    "notify",
    "Explode failed: rpc down",
    "error",
  ]);
  // A failed plugin is not retried while nothing about its host changed.
  hosts.set([...hosts.getSnapshot()]);
  await tick();
  expect(events).toHaveLength(4);
});

test("context calls reach the window; opening an unknown view throws", async () => {
  const { plugin, contexts } = board();
  const hosts = fakeHosts([
    { id: "a", label: "alpha", server: server("s"), state: running("board") },
  ]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  await tick();
  const ctx = contexts[0];
  if (!ctx) throw Error("Expected a context");
  ctx.notify("early");
  const { ui, events } = fakeUi();
  const disconnect = host.connect(ui);
  ctx.openView("main");
  ctx.focusWorkspace("ws-1");
  ctx.notify("bad", "error");
  expect(() => ctx.openView("nope")).toThrow(/no view "nope"/);
  expect(events).toEqual([
    ["notify", "early", "info"],
    ["open", { hostId: "a", pluginId: "board", viewId: "main" }],
    ["focus", "ws-1"],
    ["notify", "bad", "error"],
  ]);
  disconnect();
  ctx.notify("queued");
  expect(events).toHaveLength(4);
});

test("a host whose daemon lacks plugin support is reported once", async () => {
  const { plugin } = board();
  const entry: PluginHostEntry = {
    id: "a",
    label: "alpha",
    server: null,
    state: { kind: "offline" },
  };
  const hosts = fakeHosts([entry]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  hosts.set([{ ...entry }]);
  const { ui, events } = fakeUi();
  host.connect(ui);
  expect(events).toEqual([
    [
      "notify",
      "Update the Paseo daemon on alpha to use plugins (plugins and pluginManagement required).",
      "error",
    ],
  ]);
  expect(
    createPluginHost({ plugins: [], theme, hosts }).getSnapshot().settled.size,
  ).toBe(1);
});

test("a pending activation keeps its host unsettled", async () => {
  let finish = () => {};
  const plugin: TuiPlugin = {
    id: "board",
    apiVersion: 1,
    activate: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  };
  const hosts = fakeHosts([
    { id: "a", label: "alpha", server: server("s"), state: running("board") },
  ]);
  const host = createPluginHost({ plugins: [plugin], theme, hosts });
  await tick();
  expect([...host.getSnapshot().settled]).toEqual([]);
  finish();
  await tick();
  expect([...host.getSnapshot().settled]).toEqual(["a"]);
});

test("startup notices reach the window once it attaches", () => {
  const host = createPluginHost({
    plugins: [],
    theme,
    hosts: fakeHosts([]),
    notices: ["Plugin /x.js failed to load: nope"],
  });
  const { ui, events } = fakeUi();
  host.connect(ui);
  expect(events).toEqual([
    ["notify", "Plugin /x.js failed to load: nope", "error"],
  ]);
});
