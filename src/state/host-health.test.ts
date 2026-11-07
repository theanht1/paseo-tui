import { expect, it } from "vitest";
import {
  createReconnectSupervisor,
  type HostHealth,
  type HostHealthEntry,
  healthNotices,
  hostsSummary,
  libraryRetrying,
  nextHealth,
  retryDelay,
  type Schedule,
} from "./host-health.js";

const connected: HostHealth = { kind: "connected" };

it("starts an outage when the client disconnects and keeps its start through retries", () => {
  const dropped = nextHealth(
    connected,
    {
      status: "disconnected",
      reason: "Transport closed",
      nextRetryAt: new Date(2500).toISOString(),
    },
    1000,
  );
  expect(dropped).toEqual({
    kind: "offline",
    since: 1000,
    lastError: "Transport closed",
    nextRetryAt: 2500,
  });
  const retrying = nextHealth(
    dropped,
    { status: "connecting", attempt: 1 },
    2500,
  );
  expect(retrying).toBe(dropped);
  expect(
    nextHealth(
      retrying,
      { status: "disconnected", reason: "connect ECONNREFUSED" },
      3000,
    ),
  ).toEqual({
    kind: "offline",
    since: 1000,
    lastError: "connect ECONNREFUSED",
    nextRetryAt: null,
  });
  expect(nextHealth(retrying, { status: "connected" }, 4000)).toEqual(
    connected,
  );
});

it("reports a first connection attempt as connecting", () => {
  expect(
    nextHealth({ kind: "idle" }, { status: "connecting", attempt: 0 }, 0),
  ).toEqual({ kind: "connecting", attempt: 0 });
  expect(nextHealth(connected, { status: "disposed" }, 5)).toEqual({
    kind: "offline",
    since: 5,
    lastError: null,
    nextRetryAt: null,
  });
});

it("knows when the client library is still retrying", () => {
  expect(libraryRetrying({ status: "connecting", attempt: 2 })).toBe(true);
  expect(
    libraryRetrying({
      status: "disconnected",
      nextRetryAt: new Date(0).toISOString(),
    }),
  ).toBe(true);
  expect(libraryRetrying({ status: "disconnected", reason: "auth" })).toBe(
    false,
  );
  expect(libraryRetrying({ status: "disposed" })).toBe(false);
  expect(libraryRetrying({ status: "connected" })).toBe(false);
});

it("backs off 5 s, 10 s, 30 s, then every 60 s", () => {
  expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([
    5000, 10000, 30000, 60000, 60000, 60000,
  ]);
});

function entry(id: string, health: HostHealth, label = id): HostHealthEntry {
  return { id, label, health, version: null };
}
const offline: HostHealth = {
  kind: "offline",
  since: 0,
  lastError: "Transport closed",
  nextRetryAt: null,
};

it("announces one notice when a connected host drops and one when it recovers", () => {
  const up = [
    entry("home", connected, "local"),
    entry("b", connected, "Build"),
  ];
  const down = [
    entry("home", connected, "local"),
    entry("b", offline, "Build"),
  ];
  expect(healthNotices(up, down)).toEqual(["Build went offline · retrying"]);
  expect(
    healthNotices(down, [
      entry("home", connected, "local"),
      entry("b", { ...offline, since: 0, lastError: "refused" }, "Build"),
    ]),
  ).toEqual([]);
  expect(healthNotices(down, up)).toEqual(["Build reconnected"]);
  expect(
    healthNotices(
      [entry("b", { kind: "connecting", attempt: 0 }, "Build")],
      [entry("b", offline, "Build")],
    ),
  ).toEqual([]);
});

it("summarizes the other hosts and how many are offline", () => {
  expect(hostsSummary([entry("home", connected)])).toBe("");
  expect(
    hostsSummary([
      entry("home", connected),
      entry("b", offline),
      entry("c", connected),
    ]),
  ).toBe(" +2 hosts · 1 offline");
  expect(hostsSummary([entry("home", connected), entry("b", connected)])).toBe(
    " +1 host",
  );
});

function manualSchedule() {
  const pending: { run(): void; ms: number; cancelled: boolean }[] = [];
  const schedule: Schedule = (run, ms) => {
    const timer = { run, ms, cancelled: false };
    pending.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    schedule,
    delays: () => pending.filter((t) => !t.cancelled).map((t) => t.ms),
    fire() {
      const timer = pending.find((t) => !t.cancelled);
      if (!timer) throw Error("Nothing scheduled");
      timer.cancelled = true;
      timer.run();
    },
  };
}

it("retries a failed host on the backoff and resets once it connects", () => {
  const timers = manualSchedule();
  const runs: string[] = [];
  const supervisor = createReconnectSupervisor({
    schedule: timers.schedule,
    now: () => 1000,
  });
  expect(supervisor.failed("b", () => runs.push("b"))).toBe(6000);
  expect(timers.delays()).toEqual([5000]);
  timers.fire();
  expect(runs).toEqual(["b"]);
  supervisor.failed("b", () => runs.push("b"));
  timers.fire();
  supervisor.failed("b", () => runs.push("b"));
  timers.fire();
  supervisor.failed("b", () => runs.push("b"));
  expect(timers.delays()).toEqual([60000]);
  supervisor.reset("b");
  expect(timers.delays()).toEqual([]);
  supervisor.failed("b", () => runs.push("b"));
  expect(timers.delays()).toEqual([5000]);
  supervisor.close();
  expect(timers.delays()).toEqual([]);
});
