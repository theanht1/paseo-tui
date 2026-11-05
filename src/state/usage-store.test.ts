import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { UsagePort, UsageReportEntry } from "../connection/ports.js";
import { createUsageStore } from "./usage-store.js";

function report(id: string): UsageReportEntry {
  return {
    id,
    sourceId: id,
    sourceLabel: id,
    account: {},
    fetchedAt: "2026-11-04T00:00:00Z",
    report: { status: "available", windows: [] },
  };
}
class FakeUsage implements UsagePort {
  calls: { forceRefresh?: boolean }[] = [];
  next: UsageReportEntry[] | Error = [report("claude")];
  async list(options: { forceRefresh?: boolean } = {}) {
    this.calls.push(options);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("loads reports at once and again on each interval", async () => {
  const port = new FakeUsage();
  const store = createUsageStore(port, 60_000);
  expect(store.getSnapshot()).toEqual({ kind: "loading" });
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getSnapshot()).toEqual({
    kind: "ready",
    reports: [report("claude")],
  });
  port.next = [report("codex")];
  await vi.advanceTimersByTimeAsync(60_000);
  expect(store.getSnapshot()).toEqual({
    kind: "ready",
    reports: [report("codex")],
  });
  expect(port.calls).toEqual([{}, {}]);
  store.close();
});

test("a failed refresh keeps the last reports next to the error", async () => {
  const port = new FakeUsage();
  const store = createUsageStore(port, 60_000);
  await vi.advanceTimersByTimeAsync(0);
  port.next = Error("offline");
  await store.refresh();
  expect(store.getSnapshot()).toEqual({
    kind: "error",
    message: "offline",
    reports: [report("claude")],
  });
  store.close();
});

test("a forced refresh bypasses the daemon cache and notifies", async () => {
  const port = new FakeUsage();
  const store = createUsageStore(port, 60_000);
  await vi.advanceTimersByTimeAsync(0);
  const seen = vi.fn();
  store.subscribe(seen);
  await store.refresh({ force: true });
  expect(port.calls.at(-1)).toEqual({ forceRefresh: true });
  expect(seen).toHaveBeenCalled();
  store.close();
});

test("closing stops polling", async () => {
  const port = new FakeUsage();
  const store = createUsageStore(port, 60_000);
  await vi.advanceTimersByTimeAsync(0);
  store.close();
  await vi.advanceTimersByTimeAsync(180_000);
  expect(port.calls).toHaveLength(1);
});
