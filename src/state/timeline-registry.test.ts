import { expect, test } from "vitest";
import { agent, timelineStore } from "../test/fixtures.js";
import { createTimelineRegistry } from "./timeline-registry.js";

test("shared acquire opens once and final release closes once", () => {
  let opened = 0,
    closed = 0;
  const registry = createTimelineRegistry(() =>
    timelineStore({
      open: async () => {
        opened++;
      },
      close: () => {
        closed++;
      },
    }),
  );
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
  const registry = createTimelineRegistry(() =>
    timelineStore({
      open: async () => {
        count++;
      },
      close: () => {},
    }),
  );
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
test("rebind replaces the stores it picks even while they are ready", () => {
  const ready = timelineStore({
    getSnapshot: () => ({
      ...timelineStore().getSnapshot(),
      status: "ready",
      epoch: "e",
      error: null,
    }),
  });
  let opened = 0;
  const registry = createTimelineRegistry(() =>
    opened++ ? timelineStore() : ready,
  );
  let notified = 0;
  registry.subscribe(() => notified++);
  const a = registry.acquire(agent("a"));
  const b = registry.acquire(agent("b"));
  const before = b.store;
  registry.reopen("a");
  expect(a.store).toBe(ready);
  registry.rebind((target) => target.id === "a");
  expect(a.store).not.toBe(ready);
  expect(b.store).toBe(before);
  expect(notified).toBe(1);
  registry.rebind(() => false);
  expect(notified).toBe(1);
  registry.close();
});
