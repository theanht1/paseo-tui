import { expect, test } from "vitest";
import type { UsageReportEntry } from "../../connection/ports.js";
import type { UsageSnapshot } from "../../state/usage-store.js";
import { usageCommands } from "./usage-commands.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const claude: UsageReportEntry = {
  id: "claude",
  sourceId: "claude",
  sourceLabel: "Claude",
  account: {},
  fetchedAt: "2026-11-04T11:59:00Z",
  report: {
    status: "available",
    windows: [
      {
        id: "session",
        label: "Session",
        usedPct: 62,
        resetsAt: "2026-11-04T15:00:00Z",
      },
    ],
  },
};
function fakeUsage(snapshot: UsageSnapshot) {
  const refreshes: { force?: boolean }[] = [];
  return {
    refreshes,
    store: {
      getSnapshot: () => snapshot,
      async refresh(options: { force?: boolean } = {}) {
        refreshes.push(options);
      },
    },
  };
}

test("the Provider usage view re-reads reports and lists every window", async () => {
  const { store, refreshes } = fakeUsage({ kind: "ready", reports: [claude] });
  const [entry] = usageCommands(store, () => NOW);
  expect(entry?.title).toBe("Provider usage");
  expect(entry?.subtitle).toBe("claude 62% · resets 3h");
  const step = entry?.run();
  if (step?.kind !== "choice") throw Error("Expected a choice step");
  const rows = await step.items();
  expect(refreshes).toEqual([{}]);
  expect(rows.map((row) => row.title)).toEqual([
    "Claude · Session 62%",
    "Refresh now",
  ]);
  expect(rows[0]?.run()).toBe(step);
  expect(rows[1]?.run()).toBeUndefined();
  expect(refreshes).toEqual([{}, { force: true }]);
});

test("a failed refresh is shown above the last reports", async () => {
  const { store } = fakeUsage({
    kind: "error",
    message: "offline",
    reports: [],
  });
  const [entry] = usageCommands(store, () => NOW);
  expect(entry?.subtitle).toBe("! offline");
  const step = entry?.run();
  if (step?.kind !== "choice") throw Error("Expected a choice step");
  expect((await step.items()).map((row) => row.title)).toEqual([
    "! offline",
    "Refresh now",
  ]);
});
