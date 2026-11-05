import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type {
  ScheduleSummary,
  StoredSchedule,
} from "@getpaseo/protocol/schedule/types";
import { expect, test } from "vitest";
import {
  createScheduleAdapter,
  createTerminalListAdapter,
  createUsageAdapter,
  type ScheduleDaemon,
  type TerminalListDaemon,
  type UsageDaemon,
} from "./daemon-adapter.js";

const report: UsageReportEntry = {
  id: "claude",
  sourceId: "claude",
  sourceLabel: "Claude",
  account: {},
  fetchedAt: "2026-11-04T00:00:00Z",
  report: { status: "available", windows: [] },
};
function usageDaemon(features: {
  usageSources?: boolean;
  providerUsageList?: boolean;
}) {
  const calls: unknown[] = [];
  const daemon: UsageDaemon = {
    getLastServerInfoMessage: () => ({ features }),
    async listUsageReports(options) {
      calls.push(options);
      return { requestId: "r", reports: [report] };
    },
  };
  return { daemon, calls };
}
test("usage is absent unless the daemon reports usage", () => {
  expect(createUsageAdapter(usageDaemon({}).daemon)).toBeNull();
});
test.each(["usageSources", "providerUsageList"])(
  "usage lists reports when the daemon has %s",
  async (flag) => {
    const { daemon, calls } = usageDaemon({ [flag]: true });
    const usage = createUsageAdapter(daemon);
    expect(await usage?.list({ forceRefresh: true })).toEqual([report]);
    expect(calls).toEqual([{ forceRefresh: true }]);
  },
);

const summary: ScheduleSummary = {
  id: "s1",
  name: "Nightly",
  status: "active",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  cadence: { type: "cron", expression: "0 2 * * *" },
  target: { type: "agent", agentId: "00000000-0000-4000-8000-000000000001" },
  prompt: "Run the tests",
  nextRunAt: null,
  lastRunAt: null,
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
};
const stored: StoredSchedule = { ...summary, runs: [] };
class FakeScheduleDaemon implements ScheduleDaemon {
  calls: unknown[][] = [];
  error: string | null = null;
  async scheduleList() {
    this.calls.push(["list"]);
    return { requestId: "r", schedules: [summary], error: this.error };
  }
  async scheduleInspect(options: { id: string }) {
    this.calls.push(["inspect", options.id]);
    return {
      requestId: "r",
      schedule: this.error ? null : stored,
      error: this.error,
    };
  }
  async scheduleLogs(options: { id: string }) {
    this.calls.push(["logs", options.id]);
    return { requestId: "r", runs: [], error: this.error };
  }
  async schedulePause(options: { id: string }) {
    this.calls.push(["pause", options.id]);
    return { requestId: "r", schedule: summary, error: this.error };
  }
  async scheduleResume(options: { id: string }) {
    this.calls.push(["resume", options.id]);
    return { requestId: "r", schedule: summary, error: this.error };
  }
  async scheduleRunOnce(options: { id: string }) {
    this.calls.push(["run-once", options.id]);
    return { requestId: "r", schedule: null, error: this.error };
  }
  async scheduleDelete(options: { id: string }) {
    this.calls.push(["delete", options.id]);
    return { requestId: "r", scheduleId: options.id, error: this.error };
  }
  async scheduleCreate(
    options: Parameters<ScheduleDaemon["scheduleCreate"]>[0],
  ) {
    this.calls.push(["create", options]);
    return {
      requestId: "r",
      schedule: this.error ? null : summary,
      error: this.error,
    };
  }
}
test("schedules pass ids through and return payload data", async () => {
  const fake = new FakeScheduleDaemon();
  const schedules = createScheduleAdapter(fake);
  expect(await schedules.list()).toEqual([summary]);
  expect(await schedules.inspect("s1")).toEqual(stored);
  expect(await schedules.logs("s1")).toEqual([]);
  await schedules.pause("s1");
  await schedules.resume("s1");
  await schedules.runOnce("s1");
  await schedules.remove("s1");
  expect(fake.calls).toEqual([
    ["list"],
    ["inspect", "s1"],
    ["logs", "s1"],
    ["pause", "s1"],
    ["resume", "s1"],
    ["run-once", "s1"],
    ["delete", "s1"],
  ]);
});
test("schedule payload errors reject", async () => {
  const fake = new FakeScheduleDaemon();
  fake.error = "Schedule not found";
  const schedules = createScheduleAdapter(fake);
  await expect(schedules.list()).rejects.toThrow("Schedule not found");
  await expect(schedules.inspect("s1")).rejects.toThrow("Schedule not found");
  await expect(schedules.pause("s1")).rejects.toThrow("Schedule not found");
  await expect(schedules.remove("s1")).rejects.toThrow("Schedule not found");
});
test("creating a schedule sends a cron cadence and omits an empty name", async () => {
  const fake = new FakeScheduleDaemon();
  const created = await createScheduleAdapter(fake).create({
    name: null,
    prompt: "Check CI",
    cron: "*/5 * * * *",
    target: {
      type: "new-agent",
      config: { provider: "claude", cwd: "/repo", model: "opus" },
    },
  });
  expect(created).toEqual(summary);
  expect(fake.calls).toEqual([
    [
      "create",
      {
        prompt: "Check CI",
        cadence: { type: "cron", expression: "*/5 * * * *" },
        target: {
          type: "new-agent",
          config: { provider: "claude", cwd: "/repo", model: "opus" },
        },
      },
    ],
  ]);
});

test("terminal listings keep activity and drop unowned terminals", async () => {
  const daemon: TerminalListDaemon = {
    async listTerminals() {
      return {
        requestId: "r",
        terminals: [
          {
            id: "t1",
            name: "Shell",
            cwd: "/repo",
            workspaceId: "w1",
            activity: { state: "working", changedAt: 5 },
          },
          { id: "t2", name: "Plain", cwd: "/repo", workspaceId: "w1" },
          { id: "t3", name: "Unowned", cwd: "/repo" },
        ],
      };
    },
  };
  expect(await createTerminalListAdapter(daemon).list()).toEqual({
    entries: [
      {
        id: "t1",
        name: "Shell",
        cwd: "/repo",
        workspaceId: "w1",
        activity: { state: "working", changedAt: 5 },
      },
      {
        id: "t2",
        name: "Plain",
        cwd: "/repo",
        workspaceId: "w1",
        activity: null,
      },
    ],
  });
});
