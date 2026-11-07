import { expect, it } from "vitest";
import type { SchedulePort, UsageReportEntry } from "../connection/ports.js";
import { createEmitter } from "../state/emitter.js";
import type { HostHealth, HostHealthEntry } from "../state/host-health.js";
import type { UsageSnapshot, UsageStore } from "../state/usage-store.js";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
import type { DirectorySnapshot } from "./workspace/workspace-directory.js";

function mutable<T>(initial: T) {
  const emitter = createEmitter();
  let value = initial;
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => value,
    set(next: T) {
      value = next;
      emitter.notify();
    },
  };
}
const workspace = (id: string) => ({
  id,
  projectId: "repo",
  projectRootPath: "/repo",
  activityAt: null,
  statusEnteredAt: null,
  workspaceDirectory: `/repo/${id}`,
  name: `/repo/${id}`,
});
function merged(offline: readonly string[]): DirectorySnapshot {
  return {
    projects: [
      {
        projectId: "repo",
        projectDisplayName: "Repo",
        projectRootPath: "/repo",
        projectKind: "git",
      },
    ],
    workspaces: [workspace("one"), workspace("two")],
    terminals: [],
    error: null,
    hosts: {
      labels: new Map([
        ["one", "Build"],
        ["two", "local"],
      ]),
      placements: new Map(),
    },
    ...(offline.length ? { offline: new Set(offline) } : {}),
  };
}
const OFFLINE: HostHealth = {
  kind: "offline",
  since: 0,
  lastError: "Transport closed",
  nextRetryAt: null,
};
function entries(build: HostHealth): HostHealthEntry[] {
  return [
    { id: "home", label: "local", health: { kind: "connected" }, version: "1" },
    { id: "build", label: "Build", health: build, version: null },
  ];
}

it("dims an offline host's workspaces, holds its panes and resumes them on reconnect", async () => {
  const directory = mutable(merged(["one"]));
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { directory },
  );
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "host offline, reconnecting…");
  expect(app.lastFrame()).toContain("host offline, reconnecting…");
  const row = app
    .lastFrame()
    .split("\n")
    .find((line) => line.includes("/repo/one"));
  expect(row).toMatch(/\/repo\/one\s+Build offline/);
  expect(app.lastFrame()).toContain("host offline, reconnecting…");
  expect(app.lastFrame()).not.toContain("hello alpha");
  directory.set(merged([]));
  await settleUntil(app.lastFrame, "hello alpha");
  expect(app.lastFrame()).toContain("hello alpha");
  expect(app.lastFrame()).not.toContain("host offline, reconnecting…");
});

it("announces one notice when a host drops and one when it is back", async () => {
  const health = mutable(entries({ kind: "connected" }));
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { hostHealth: health },
  );
  await settle();
  health.set(entries(OFFLINE));
  await settleUntil(app.lastFrame, "Build went offline · retrying");
  expect(app.lastFrame()).toContain("Build went offline · retrying");
  health.set(entries({ ...OFFLINE, lastError: "connect ECONNREFUSED" }));
  await settle();
  expect(app.lastFrame()).toContain("Build went offline · retrying");
  health.set(entries({ kind: "connected" }));
  await settleUntil(app.lastFrame, "Build reconnected");
  expect(app.lastFrame()).toContain("Build reconnected");
});

const claude: UsageReportEntry = {
  id: "claude",
  sourceId: "claude",
  sourceLabel: "Claude",
  account: {},
  fetchedAt: "2026-11-04T00:00:00Z",
  report: {
    status: "available",
    windows: [{ id: "session", label: "Session", usedPct: 62 }],
  },
};
const OFFLINE_USAGE: UsageSnapshot = {
  kind: "error",
  message: "Transport not connected",
  reports: [claude],
};
const usage: UsageStore = {
  getSnapshot: () => OFFLINE_USAGE,
  subscribe: () => () => {},
  refresh: async () => {},
  close() {},
};
const schedules: SchedulePort = {
  list: async () => {
    throw Error("Transport not connected");
  },
  inspect: async () => {
    throw Error("Unexpected");
  },
  logs: async () => [],
  pause: async () => {},
  resume: async () => {},
  runOnce: async () => {},
  remove: async () => {},
  create: async () => {
    throw Error("Unexpected");
  },
};

it("shows usage and schedules as unavailable while the startup host is offline", async () => {
  const { app, connection } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { usage, schedules },
  );
  await settle();
  expect(app.lastFrame()).toContain("claude 62%");
  connection.emit({ status: "disconnected", reason: "Transport closed" });
  await settle();
  expect(app.lastFrame()).toContain("usage unavailable");
  expect(app.lastFrame()).not.toContain("claude 62%");
  app.stdin.write(":");
  await settle();
  app.stdin.write("Schedules");
  await settle();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Unavailable · host offline, reconnecting…");
  expect(app.lastFrame()).toContain(
    "Unavailable · host offline, reconnecting…",
  );
  expect(app.lastFrame()).not.toContain("Transport not connected");
});
