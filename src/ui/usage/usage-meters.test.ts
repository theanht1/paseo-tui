import { expect, test } from "vitest";
import type { UsageReportEntry } from "../../connection/ports.js";
import {
  relativeDuration,
  usageDetailRows,
  usageMeters,
} from "./usage-meters.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");
function entry(
  id: string,
  report: UsageReportEntry["report"],
  label = id,
): UsageReportEntry {
  return {
    id,
    sourceId: id,
    sourceLabel: label,
    account: {},
    fetchedAt: "2026-11-04T11:59:00Z",
    report,
  };
}
const claude = entry(
  "claude",
  {
    status: "available",
    planLabel: "Max",
    windows: [
      {
        id: "week",
        label: "Weekly",
        usedPct: 30,
        resetsAt: "2026-11-08T12:00:00Z",
      },
      {
        id: "session",
        label: "5-hour session",
        shortLabel: "5h",
        remainingPct: 38,
        resetsAt: "2026-11-04T15:00:00Z",
      },
    ],
  },
  "Claude",
);

test("relative durations round to the largest unit", () => {
  expect(relativeDuration(30_000)).toBe("<1m");
  expect(relativeDuration(45 * 60_000)).toBe("45m");
  expect(relativeDuration(3 * 3_600_000 + 10 * 60_000)).toBe("3h");
  expect(relativeDuration(4 * 86_400_000)).toBe("4d");
});

test("the meter shows each reporting provider's most-used window", () => {
  expect(usageMeters([claude], NOW)).toBe("claude 62% · resets 3h");
});

test("a summary window wins over the most-used one", () => {
  const codex = entry("codex", {
    status: "available",
    windows: [
      { id: "a", label: "Primary", usedPct: 90 },
      { id: "b", label: "Summary", summary: true, usedPct: 10 },
    ],
  });
  expect(usageMeters([codex], NOW)).toBe("codex 10%");
});

test("providers without usable windows are left out of the meter", () => {
  const reports = [
    entry("gemini", { status: "error", error: "Rate limited" }),
    entry("amp", {
      status: "unavailable",
      problem: { kind: "no_quota", detail: "Pay as you go" },
    }),
    entry("pi", { status: "available", windows: [] }),
    claude,
  ];
  expect(usageMeters(reports, NOW)).toBe("claude 62% · resets 3h");
  expect(usageMeters(reports.slice(0, 3), NOW)).toBe("");
});

test("details list every window, balance and problem", () => {
  const rows = usageDetailRows(
    [
      claude,
      entry(
        "openrouter",
        {
          status: "available",
          windows: [],
          balances: [
            {
              id: "credits",
              label: "Credits",
              remaining: 12.5,
              limit: 20,
              unit: "usd",
            },
          ],
          details: [{ id: "tier", label: "Tier", value: "Free" }],
        },
        "OpenRouter",
      ),
      entry("gemini", { status: "error", error: "Rate limited" }),
      entry("amp", {
        status: "unavailable",
        problem: { kind: "no_quota", detail: "Pay as you go" },
      }),
    ],
    NOW,
  );
  expect(rows.map((row) => [row.title, row.subtitle])).toEqual([
    ["Claude · Weekly 30%", "Max · resets in 4d"],
    ["Claude · 5-hour session 62%", "Max · resets in 3h"],
    ["OpenRouter · Credits $12.50 left of $20.00", ""],
    ["OpenRouter · Tier: Free", ""],
    ["gemini · error", "Rate limited"],
    ["amp · unavailable", "Pay as you go"],
  ]);
});
