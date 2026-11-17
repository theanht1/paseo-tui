import { afterEach, expect, test, vi } from "vitest";
import { createEmitter } from "../state/emitter.js";
import type { ServerPluginsSnapshot } from "../state/server-plugins.js";
import { settle, settleUntil, setup } from "../test/app-harness.js";
import { fixturePlugin } from "../test/fixture-plugin.js";
import { loadLayoutMemory } from "./layout/layout-memory.js";
import { defineTuiPlugin, type TuiPlugin } from "./plugins/api.js";
import {
  createPluginHost,
  type PluginHostEntry,
} from "./plugins/plugin-host.js";
import { createTheme } from "./render/theme.js";

afterEach(() => {
  vi.restoreAllMocks();
});
function running(...ids: string[]): ServerPluginsSnapshot {
  return { kind: "ready", running: new Set(ids) };
}
function fakeServer() {
  const calls: unknown[][] = [];
  return {
    serverId: "srv-home",
    calls,
    async rpc(pluginId: string, method: string, input: unknown) {
      calls.push([pluginId, method, input]);
      return { pong: true };
    },
  };
}
async function start(
  options: {
    state?: ServerPluginsSnapshot;
    plugins?: TuiPlugin[];
    keys?: Record<string, string[]>;
    layouts?: Awaited<ReturnType<typeof loadLayoutMemory>>;
  } = {},
) {
  const server = fakeServer();
  const emitter = createEmitter();
  let entries: readonly PluginHostEntry[] = [
    {
      id: "home",
      label: "Home",
      server,
      state: options.state ?? running("fixture"),
    },
  ];
  const host = createPluginHost({
    plugins: options.plugins ?? [fixturePlugin()],
    theme: createTheme({}, {}),
    hosts: { subscribe: emitter.subscribe, getSnapshot: () => entries },
  });
  const result = await setup(
    undefined,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      plugins: {
        host,
        keys: new Map(Object.entries(options.keys ?? {})),
        hostOf: () => "home",
      },
      ...(options.layouts ? { layouts: options.layouts } : {}),
    },
  );
  const { app, test: renderer } = result;
  async function press(...keys: string[]) {
    for (const key of keys) {
      app.stdin.write(key);
      await settle();
    }
  }
  return {
    ...result,
    server,
    press,
    async closeOverlay() {
      renderer.mockInput.pressEscape();
      await settle();
    },
    async type(text: string) {
      for (const char of text) app.stdin.write(char);
      await settle();
    },
    /** Runs the Command Center entry matching `query`. */
    async command(query: string) {
      await press("\u000b");
      for (const char of query) app.stdin.write(char);
      await settle();
      await press("\r");
    },
    async setState(state: ServerPluginsSnapshot) {
      entries = [{ id: "home", label: "Home", server, state }];
      emitter.notify();
      await settle();
    },
  };
}

test("a plugin action is in the Command Center and opens its view as a focused tab", async () => {
  const { app, press, type } = await start();
  await press("\u000b");
  await type("fixture panel");
  expect(app.lastFrame()).toMatch(/Open fixture panel\s+B/);
  expect(app.lastFrame()).not.toContain("Fixture on Home");

  await press("\r");
  expect(app.lastFrame()).toContain("▤ Fixture panel");
  expect(app.lastFrame()).toContain("Fixture on Home focused");
});

test("a view gets keys only while it has the keyboard", async () => {
  const { app, press, command } = await start();
  await command("fixture panel");
  await press("a", "?");
  expect(app.lastFrame()).toContain("typed:a?");
  expect(app.lastFrame()).toContain("View input · Ctrl-] TUI shortcuts");

  await press("\u001d", "b");
  expect(app.lastFrame()).toContain("Fixture on Home idle");
  expect(app.lastFrame()).toContain("typed:a?");
  expect(app.lastFrame()).not.toContain("View input");

  await press("i", "c");
  expect(app.lastFrame()).toContain("typed:a?c");

  // An agent tab takes the screen and the keys; the view keeps neither.
  await press("\u001d", "g", "t");
  expect(app.lastFrame()).not.toContain("Fixture on Home");
  await press("d");

  // The view stayed mounted behind the other tab, so it kept its state.
  await press("g", "T", "i", "e");
  expect(app.lastFrame()).toContain("typed:a?ce");
});

test("rpc reaches the plugin's server on its host", async () => {
  const { app, server, command } = await start();
  await command("Ping fixture");
  expect(server.calls).toEqual([["fixture", "ping", { n: 1 }]]);
  await settleUntil(app.lastFrame, "Fixture said");
  expect(app.lastFrame()).toContain('Fixture said {"pong":true}');
});

test("a host that does not run the server plugin shows none of it", async () => {
  const { app, press, type, closeOverlay } = await start({
    state: running("other"),
  });
  await press("\u000b");
  await type("fixture");
  expect(app.lastFrame()).not.toContain("Open fixture panel");
  await closeOverlay();
  await press("B");
  expect(app.lastFrame()).not.toContain("Fixture panel");
});

test("disabling the server plugin closes its view and removes its actions", async () => {
  const { app, press, type, closeOverlay, command, setState } = await start();
  await command("fixture panel");
  expect(app.lastFrame()).toContain("Fixture on Home focused");

  await setState(running());
  expect(app.lastFrame()).not.toContain("Fixture");
  expect(app.lastFrame()).toContain("NORMAL");
  await press("\u000b");
  await type("fixture");
  expect(app.lastFrame()).not.toContain("Open fixture panel");
  // The app still works: an agent tab is back on screen.
  await closeOverlay();
  expect(app.lastFrame()).toContain("Alpha agent");
});

test("a plugin that throws while starting, running or rendering leaves the app running", async () => {
  const broken = defineTuiPlugin({
    id: "broken",
    apiVersion: 1,
    activate() {
      throw Error("activate exploded");
    },
  });
  // React reports the caught render error on the console.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { app, press, type, command } = await start({
    state: running("fixture", "broken"),
    plugins: [broken, fixturePlugin()],
  });
  expect(app.lastFrame()).toContain(
    "Plugin broken failed on Home: activate exploded",
  );

  await command("Explode fixture");
  await settleUntil(app.lastFrame, "action exploded");
  expect(app.lastFrame()).toContain("Explode fixture failed: action exploded");

  await command("Open broken view");
  expect(app.lastFrame()).toContain("Broken failed: view exploded");
  // The other view and the rest of the app still work.
  await press("\u001d");
  await command("fixture panel");
  expect(app.lastFrame()).toContain("Fixture on Home focused");
  await press("\u001d", "?", "/");
  await type("fixture");
  expect(app.lastFrame()).toContain("Open fixture panel");
});

test("a plugin action's default key runs it and `keys` rebinds it", async () => {
  const byDefault = await start();
  await byDefault.press("B");
  expect(byDefault.app.lastFrame()).toContain("Fixture on Home focused");

  const { app, press, type } = await start({
    keys: { "plugin.fixture.open": ["Y"], "plugin.fixture.nope": ["M"] },
  });
  expect(app.lastFrame()).toContain(
    'keys."plugin.fixture.nope": unknown action',
  );
  await press("B");
  expect(app.lastFrame()).not.toContain("Fixture on Home");
  await press("Y");
  expect(app.lastFrame()).toContain("Fixture on Home focused");
  // Help lists the configured key.
  await press("\u001d", "?", "/");
  await type("fixture panel");
  expect(app.lastFrame()).toMatch(/Y\s+Open fixture panel/);
});

function memoryFile(initial: string | null = null) {
  let contents = initial;
  return {
    get contents() {
      return contents;
    },
    async read() {
      return contents;
    },
    async write(next: string) {
      contents = next;
    },
  };
}
const manual = { schedule: () => () => {} };

test("an open view comes back after a restart only while its plugin is active", async () => {
  const file = memoryFile();
  const layouts = await loadLayoutMemory(file, manual);
  const first = await start({ layouts });
  await first.command("fixture panel");
  expect(first.app.lastFrame()).toContain("▤ Fixture panel");
  await first.press("\u001d", "g", "t");
  await layouts.flush();

  // The host is still listing its plugins: the view waits, then returns.
  const loading = await start({
    state: { kind: "loading" },
    layouts: await loadLayoutMemory(memoryFile(file.contents), manual),
  });
  await loading.press("\r");
  expect(loading.app.lastFrame()).not.toContain("Fixture panel");
  await loading.setState(running("fixture"));
  expect(loading.app.lastFrame()).toContain("▤ Fixture panel");

  // The host no longer runs the plugin: the view is dropped for good.
  const disabled = await start({
    state: running(),
    layouts: await loadLayoutMemory(memoryFile(file.contents), manual),
  });
  await disabled.press("\r");
  expect(disabled.app.lastFrame()).not.toContain("Fixture panel");
  await disabled.setState(running("fixture"));
  expect(disabled.app.lastFrame()).not.toContain("Fixture panel");
});
