import { expect, it } from "vitest";
import type {
  CreateScheduleInput,
  SchedulePort,
  ScheduleSummary,
  UsageReportEntry,
} from "../connection/ports.js";
import type { UsageSnapshot, UsageStore } from "../state/usage-store.js";
import {
  agents,
  rowText,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import type { AppProps } from "./App.js";

const claude: UsageReportEntry = {
  id: "claude",
  sourceId: "claude",
  sourceLabel: "Claude",
  account: {},
  fetchedAt: "2026-11-04T00:00:00Z",
  report: {
    status: "available",
    planLabel: "Max",
    windows: [{ id: "session", label: "Session", usedPct: 62 }],
  },
};
function usageStore(snapshot: UsageSnapshot): UsageStore {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => {},
    close() {},
  };
}
const nightly: ScheduleSummary = {
  id: "s1",
  name: "Nightly tests",
  status: "active",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  cadence: { type: "every", everyMs: 300_000 },
  target: { type: "new-agent", config: { provider: "codex", cwd: "/repo" } },
  prompt: "Run the tests",
  nextRunAt: null,
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
};
class FakeSchedules implements SchedulePort {
  calls: unknown[][] = [];
  list = async () => [nightly];
  inspect = async () => ({ ...nightly, runs: [] });
  logs = async () => [];
  pause = async (id: string) => {
    this.calls.push(["pause", id]);
  };
  resume = async () => {};
  runOnce = async () => {};
  remove = async () => {};
  create = async (input: CreateScheduleInput) => {
    this.calls.push(["create", input]);
    return nightly;
  };
}
function terminalApi(): NonNullable<AppProps["terminals"]> {
  const terminal = {
    id: "shell",
    current: () => null,
    refresh: async () => null,
    write: (data: string) => data.length,
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: "shell",
      requestId: "r",
      lines: ["ready"],
      totalLines: 1,
    }),
    kill: async () => {},
  };
  return {
    list: async () => ({ requestId: "r", entries: [] }),
    ref: () => terminal,
    create: async () => terminal,
  };
}

it("shows provider usage in the status bar and its details in the Command Center", async () => {
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      usage: usageStore({ kind: "ready", reports: [claude] }),
    },
  );
  expect(app.lastFrame()).toContain("claude 62%");
  app.stdin.write(":");
  await settle();
  app.stdin.write("Provider usage");
  await settle();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Claude · Session 62%");
  expect(app.lastFrame()).toContain("Claude · Session 62%");
  expect(app.lastFrame()).toContain("Max");
});

it("pauses a schedule from the Command Center only after confirming", async () => {
  const schedules = new FakeSchedules();
  const { app } = await setup(
    agents,
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      schedules,
    },
  );
  app.stdin.write(":");
  await settle();
  app.stdin.write("Schedules");
  await settle();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Nightly tests");
  expect(app.lastFrame()).toContain("every 5m · → new codex agent in /repo");
  app.stdin.write("Nightly");
  await settle();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Pause…");
  app.stdin.write("Pause");
  await settle();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Pause Nightly tests?");
  expect(schedules.calls).toEqual([]);
  app.stdin.write("y");
  await settleUntil(app.lastFrame, "Paused Nightly tests");
  expect(schedules.calls).toEqual([["pause", "s1"]]);
  expect(app.lastFrame()).toContain("Paused Nightly tests");
});

it("shows a spinner on a working terminal tab and a dot once it finishes", async () => {
  const { app, test, setTerminals } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    terminalApi(),
  );
  const shell = {
    id: "shell",
    workspaceId: "one",
    cwd: "/repo/one",
    name: "Shell",
  };
  setTerminals([{ ...shell, activity: { state: "working", changedAt: 1 } }]);
  await settle();
  expect(rowText(test, "tab:terminal:shell")).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] ▣ Shell/);
  setTerminals([
    {
      ...shell,
      activity: { state: "idle", attentionReason: "finished", changedAt: 2 },
    },
  ]);
  await settle();
  expect(rowText(test, "tab:terminal:shell")).toContain("● ▣ Shell");
  expect(app.lastFrame()).toContain("Shell");
});
