import { expect, test } from "vitest";
import type { UsageReportEntry } from "../../connection/ports.js";
import type { UsageConfig, UsageSelection } from "../config/user-config.js";
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
    ["Claude · Weekly 30%", "Max · resets in 4d · id claude.week"],
    ["Claude · 5-hour session 62%", "Max · resets in 3h · id claude.session"],
    ["OpenRouter · Credits $12.50 left of $20.00", "id openrouter.credits"],
    ["OpenRouter · Tier: Free", "id openrouter.tier"],
    ["gemini · error", "Rate limited"],
    ["amp · unavailable", "Pay as you go"],
  ]);
});

const claudeWindows = entry(
  "claude",
  {
    status: "available",
    windows: [
      {
        id: "five_hour",
        label: "5-hour session",
        shortLabel: "5h",
        usedPct: 62,
      },
      { id: "seven_day", label: "Weekly", shortLabel: "wk", usedPct: 30 },
    ],
    balances: [{ id: "credits", label: "Credits", remaining: 5, unit: "usd" }],
    details: [{ id: "tier", label: "Tier", value: "Free" }],
  },
  "Claude",
);
function config(entries: [string, UsageSelection][]): UsageConfig {
  return new Map(entries);
}

test("config picks providers in config order", () => {
  const codex = entry("codex", {
    status: "available",
    windows: [{ id: "a", label: "A", usedPct: 10 }],
  });
  const text = usageMeters(
    [codex, claudeWindows],
    NOW,
    config([
      ["claude", "default"],
      ["codex", "default"],
    ]),
  );
  expect(text).toBe("claude 62%  codex 10%");
});

test("array shows the chosen windows", () => {
  expect(
    usageMeters(
      [claudeWindows],
      NOW,
      config([["claude", ["seven_day", "five_hour"]]]),
    ),
  ).toBe("claude wk 30% · 5h 62%");
});

test("each selected window gets its own reset suffix and an empty short label prints the percent alone", () => {
  const reset = entry(
    "claude",
    {
      status: "available",
      windows: [
        {
          id: "a",
          label: "A",
          shortLabel: "",
          usedPct: 40,
          resetsAt: "2026-11-04T15:00:00Z",
        },
        {
          id: "b",
          label: "Beta",
          usedPct: 20,
          resetsAt: "2026-11-08T12:00:00Z",
        },
      ],
    },
    "Claude",
  );
  expect(usageMeters([reset], NOW, config([["claude", ["a", "b"]]]))).toBe(
    "claude 40% · resets 3h · Beta 20% · resets 4d",
  );
});

test("balances and details are selectable", () => {
  expect(
    usageMeters([claudeWindows], NOW, config([["claude", ["credits"]]])),
  ).toBe("claude Credits $5.00 left");
  expect(
    usageMeters([claudeWindows], NOW, config([["claude", ["tier"]]])),
  ).toBe("claude Tier Free");
});

test("unknown configured ids show nothing", () => {
  expect(
    usageMeters(
      [claudeWindows],
      NOW,
      config([
        ["ghost", "default"],
        ["claude", ["nope"]],
      ]),
    ),
  ).toBe("");
});

test("hidden providers drop out", () => {
  expect(
    usageMeters([claudeWindows], NOW, config([["claude", "hidden"]])),
  ).toBe("");
});

test("usageDetailRows marks ids and hidden", () => {
  const rows = usageDetailRows(
    [claudeWindows],
    NOW,
    config([["claude", ["five_hour"]]]),
  );
  expect(rows.map((row) => row.subtitle)).toEqual([
    "id claude.five_hour",
    "id claude.seven_day · hidden",
    "id claude.credits · hidden",
    "id claude.tier · hidden",
  ]);
  const hiddenProvider = usageDetailRows(
    [claudeWindows],
    NOW,
    config([["claude", "hidden"]]),
  );
  expect(hiddenProvider[0]?.subtitle).toBe("id claude.five_hour · hidden");
});

test("a selected window without a percentage is marked hidden, matching the meter", () => {
  const unmeasured = entry(
    "claude",
    {
      status: "available",
      windows: [
        { id: "blank", label: "Blank" },
        { id: "five_hour", label: "5h", usedPct: 10 },
      ],
    },
    "Claude",
  );
  const selection = config([["claude", ["blank", "five_hour"]]]);
  expect(usageMeters([unmeasured], NOW, selection)).toBe("claude 5h 10%");
  expect(
    usageDetailRows([unmeasured], NOW, selection).map((row) => row.subtitle),
  ).toEqual(["id claude.blank · hidden", "id claude.five_hour"]);
});
