import { expect, it, vi } from "vitest";
import { createWorkingIndicator } from "./working-indicator.js";

it("animates while mounted and stops on disposal", () => {
  vi.useFakeTimers();
  const indicator = createWorkingIndicator();
  const first = indicator.getSnapshot();
  const stop = indicator.start();
  vi.advanceTimersByTime(100);
  expect(indicator.getSnapshot()).not.toBe(first);
  stop();
  const last = indicator.getSnapshot();
  vi.advanceTimersByTime(100);
  expect(indicator.getSnapshot()).toBe(last);
  vi.useRealTimers();
});
it("includes elapsed time for a running turn", () => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  const indicator = createWorkingIndicator(5000);
  const stop = indicator.start();
  expect(indicator.elapsed()).toBe("5s");
  vi.advanceTimersByTime(62000);
  expect(indicator.elapsed()).toBe("1m 7s");
  stop();
  vi.useRealTimers();
});
