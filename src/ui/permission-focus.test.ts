import { expect, test } from "vitest";
import type { AgentPort } from "../state/ports.js";
import { agent } from "../state/test-fixtures.js";
import { createTimelineStore } from "../state/timeline-store.js";
import { type Focus, watchPermissions } from "./permission-focus.js";

test("new permissions take focus, removal selects next then timeline, defer stays deferred", () => {
  let current = agent("a");
  const port: AgentPort = {
    snapshot: () => current,
    subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
    fetchTail: async () => {
      throw Error("unused");
    },
    fetchAfter: async () => {
      throw Error("unused");
    },
    send: async () => {},
    respondToPermission: async () => {},
    cancel: async () => {},
  };
  // The watcher uses the store boundary's snapshot and subscription only.
  current = agent("a", {
    pendingPermissions: [
      { id: "one", provider: "codex", kind: "tool", name: "one" },
    ],
  });
  const store = createTimelineStore(port);
  let focus: Focus = { pane: "prompt" };
  const update = (f: (v: Focus) => Focus) => {
    focus = f(focus);
  };
  current = agent("a", {
    pendingPermissions: [
      { id: "one", provider: "codex", kind: "tool", name: "one" },
    ],
  });
  const stop = watchPermissions(store, update);
  expect(focus).toEqual({ pane: "permission", requestId: "one" });
  stop();
  store.close();
});
