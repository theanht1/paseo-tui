import { expect, test } from "vitest";
import { agent } from "./test-fixtures.js";
import { createTimelineRegistry } from "./timeline-registry.js";
import type { TimelineSnapshot } from "./timeline-store.js";

test("shared acquire opens once and final release closes once", () => {
  let opened = 0,
    closed = 0;
  const registry = createTimelineRegistry(() => ({
    open: async () => {
      opened++;
    },
    close: () => {
      closed++;
    },
    subscribe: () => () => {},
    getSnapshot: (): TimelineSnapshot => ({
      status: "closed",
      epoch: null,
      error: null,
      rows: [],
      turn: { kind: "idle" },
      pendingPermissions: [],
      lastActionError: null,
    }),
    send: async () => {},
    respond: async () => {},
    cancel: async () => {},
  }));
  const a = registry.acquire(agent("a")),
    b = registry.acquire(agent("a"));
  expect(a.store).toBe(b.store);
  expect(opened).toBe(1);
  a.release();
  expect(closed).toBe(0);
  b.release();
  b.release();
  expect(closed).toBe(1);
  const next = registry.acquire(agent("a"));
  registry.close();
  next.release();
  expect(closed).toBe(2);
});
test("reopen replaces failed or closed store and notifies holders", () => {
  let count = 0,
    notified = 0;
  const registry = createTimelineRegistry(() => ({
    open: async () => {
      count++;
    },
    close: () => {},
    subscribe: () => () => {},
    getSnapshot: (): TimelineSnapshot => ({
      status: "closed",
      epoch: null,
      error: null,
      rows: [],
      turn: { kind: "idle" },
      pendingPermissions: [],
      lastActionError: null,
    }),
    send: async () => {},
    respond: async () => {},
    cancel: async () => {},
  }));
  const holder = registry.acquire(agent("a"));
  const before = holder.store;
  registry.subscribe(() => notified++);
  registry.reopen("a");
  expect(holder.store).not.toBe(before);
  expect(count).toBe(2);
  expect(notified).toBe(1);
  holder.release();
  registry.close();
});
