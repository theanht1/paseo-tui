import { expect, test } from "vitest";
import type { PluginPort, ServerPlugin } from "../connection/ports.js";
import { createServerPluginStore } from "./server-plugins.js";

function fakePort(initial: ServerPlugin[]) {
  let plugins = initial;
  let change: (() => void) | null = null;
  let failing = false;
  let released = 0;
  const port: PluginPort = {
    serverId: "srv-1",
    async list() {
      if (failing) throw Error("list failed");
      return plugins;
    },
    rpc: async () => null,
    observe(handler) {
      change = handler;
      return async () => {
        released++;
      };
    },
  };
  return {
    port,
    released: () => released,
    fail(value: boolean) {
      failing = value;
    },
    set(next: ServerPlugin[]) {
      plugins = next;
      change?.();
    },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("lists the running server plugins and follows catalog changes", async () => {
  const fake = fakePort([
    { id: "board", running: true },
    { id: "off", running: false },
  ]);
  const store = createServerPluginStore(fake.port);
  expect(store.getSnapshot()).toEqual({ kind: "loading" });
  let notified = 0;
  store.subscribe(() => notified++);
  await tick();
  expect(store.getSnapshot()).toEqual({
    kind: "ready",
    running: new Set(["board"]),
  });
  const before = store.getSnapshot();
  fake.set([{ id: "board", running: true }]);
  await tick();
  expect(store.getSnapshot()).toBe(before);
  fake.set([{ id: "board", running: false }]);
  await tick();
  expect(store.getSnapshot()).toEqual({ kind: "ready", running: new Set() });
  expect(notified).toBe(2);
  await store.close();
  expect(fake.released()).toBe(1);
});

test("goes offline with the connection and relists when it is back", async () => {
  const fake = fakePort([{ id: "board", running: true }]);
  const store = createServerPluginStore(fake.port);
  await tick();
  store.offline();
  expect(store.getSnapshot()).toEqual({ kind: "offline" });
  void store.load();
  await tick();
  expect(store.getSnapshot()).toEqual({
    kind: "ready",
    running: new Set(["board"]),
  });
});

test("a failed relist keeps the last known plugins", async () => {
  const fake = fakePort([{ id: "board", running: true }]);
  const store = createServerPluginStore(fake.port);
  await tick();
  fake.fail(true);
  fake.set([]);
  await tick();
  expect(store.getSnapshot()).toEqual({
    kind: "ready",
    running: new Set(["board"]),
  });
});

test("a listing that answers after the host went offline is dropped", async () => {
  const fake = fakePort([{ id: "board", running: true }]);
  const store = createServerPluginStore(fake.port);
  store.offline();
  await tick();
  expect(store.getSnapshot()).toEqual({ kind: "offline" });
});
