import type { PaseoAgent } from "@getpaseo/client";
import { expect, test } from "vitest";
import { createEmitter } from "../../state/emitter.js";
import type { TimelineRegistry } from "../../state/timeline-registry.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import { agent, timelineStore } from "../../test/fixtures.js";
import { createPaneTimelines } from "./pane-timelines.js";
import type { PaneNode } from "./split-tree.js";

function fakeRegistry() {
  const emitter = createEmitter();
  const held = new Map<string, number>();
  const stores = new Map<string, TimelineStore>();
  function storeFor(id: string) {
    const store = timelineStore();
    stores.set(id, store);
    return store;
  }
  const registry: TimelineRegistry = {
    acquire(target: PaseoAgent) {
      held.set(target.id, (held.get(target.id) ?? 0) + 1);
      if (!stores.has(target.id)) storeFor(target.id);
      return {
        get store() {
          const store = stores.get(target.id);
          if (!store) throw Error(`no store for ${target.id}`);
          return store;
        },
        release() {
          held.set(target.id, (held.get(target.id) ?? 0) - 1);
        },
      };
    },
    reopen(id) {
      storeFor(id);
      emitter.notify();
    },
    subscribe: emitter.subscribe,
    close() {},
  };
  return { registry, held };
}
function pane(id: string, agentId: string | null): PaneNode {
  return { kind: "pane", id, agentId };
}

test("holds one timeline per pane whose agent is known", () => {
  const { registry, held } = fakeRegistry();
  const timelines = createPaneTimelines(registry);
  timelines.sync([pane("p1", "a"), pane("p2", "missing")], [agent("a")]);
  expect([...timelines.getSnapshot().keys()]).toEqual(["p1:a"]);
  expect(held.get("a")).toBe(1);
  timelines.sync(
    [pane("p1", "a"), pane("p2", "missing")],
    [agent("a"), agent("missing")],
  );
  expect([...timelines.getSnapshot().keys()]).toEqual(["p1:a", "p2:missing"]);
});

test("releases a timeline when its pane shows another agent", () => {
  const { registry, held } = fakeRegistry();
  const timelines = createPaneTimelines(registry);
  const agents = [agent("a"), agent("b")];
  timelines.sync([pane("p1", "a")], agents);
  timelines.sync([pane("p1", "b")], agents);
  expect([...timelines.getSnapshot().keys()]).toEqual(["p1:b"]);
  expect(held.get("a")).toBe(0);
  expect(held.get("b")).toBe(1);
});

test("keeps the snapshot stable until something changes", () => {
  const { registry } = fakeRegistry();
  const timelines = createPaneTimelines(registry);
  timelines.sync([pane("p1", "a")], [agent("a")]);
  const first = timelines.getSnapshot();
  timelines.sync([pane("p1", "a")], [agent("a")]);
  expect(timelines.getSnapshot()).toBe(first);
});

test("publishes the replacement store when the registry reopens a timeline", () => {
  const { registry } = fakeRegistry();
  const timelines = createPaneTimelines(registry);
  timelines.sync([pane("p1", "a")], [agent("a")]);
  const before = timelines.getSnapshot().get("p1:a");
  let notified = 0;
  timelines.subscribe(() => notified++);
  registry.reopen("a");
  expect(notified).toBe(1);
  expect(timelines.getSnapshot().get("p1:a")).not.toBe(before);
});

test("close releases every held timeline", () => {
  const { registry, held } = fakeRegistry();
  const timelines = createPaneTimelines(registry);
  timelines.sync([pane("p1", "a"), pane("p2", "a")], [agent("a")]);
  expect(held.get("a")).toBe(2);
  timelines.close();
  expect(held.get("a")).toBe(0);
  expect(timelines.getSnapshot().size).toBe(0);
});
