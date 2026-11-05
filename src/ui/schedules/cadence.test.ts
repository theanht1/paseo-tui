import { expect, test } from "vitest";
import { cadenceLabel, parseCadence } from "./cadence.js";

test.each([
  ["5m", "*/5 * * * *"],
  ["every 15m", "*/15 * * * *"],
  ["1h", "0 * * * *"],
  ["6h", "0 */6 * * *"],
  ["1d", "0 0 * * *"],
  ["0 9 * * 1-5", "0 9 * * 1-5"],
])("%s becomes the cron %s", (text, cron) => {
  expect(parseCadence(text)).toEqual({ kind: "ok", cron });
});

test.each([
  ["", "Enter an interval like 5m or a cron expression"],
  ["7m", "7m doesn't divide evenly into cron; use a cron expression"],
  ["30s", "30s doesn't divide evenly into cron; use a cron expression"],
])("%j is rejected", (text, message) => {
  expect(parseCadence(text)).toEqual({ kind: "error", message });
});

test("an invalid cron expression reports why", () => {
  const result = parseCadence("99 * * * *");
  expect(result.kind).toBe("error");
});

test("cadence labels read naturally", () => {
  expect(cadenceLabel({ type: "every", everyMs: 300_000 })).toBe("every 5m");
  expect(cadenceLabel({ type: "every", everyMs: 5_400_000 })).toBe("every 90m");
  expect(cadenceLabel({ type: "cron", expression: "*/5 * * * *" })).toBe(
    "cron */5 * * * *",
  );
  expect(
    cadenceLabel({
      type: "cron",
      expression: "0 9 * * 1-5",
      timezone: "Europe/Paris",
    }),
  ).toBe("cron 0 9 * * 1-5 (Europe/Paris)");
});
