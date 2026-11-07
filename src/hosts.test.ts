import { expect, it } from "vitest";
import type { HostConnectionState as ConnectionState } from "./connection/ports.js";
import type { HostTarget } from "./connection/target.js";
import { createHosts, type HostLive } from "./hosts.js";
import { loadHostRegistry } from "./state/host-registry.js";
import { NO_PROJECT_ACTIONS } from "./test/fixtures.js";

function memory() {
  let text: string | null = null;
  return {
    read: async () => text,
    write: async (contents: string) => {
      text = contents;
    },
  };
}
interface FakeLive extends HostLive {
  set(state: ConnectionState): void;
  reconnects: number;
}
const lives = new Map<string, FakeLive[]>();
function live(label: string, closed: string[]): FakeLive {
  let state: ConnectionState = { status: "connected" };
  const listeners = new Set<() => void>();
  const value: FakeLive = {
    label,
    reconnects: 0,
    set(next) {
      state = next;
      for (const listener of listeners) listener();
    },
    version: () => (state.status === "connected" ? `${label}-1.0` : null),
    reconnect() {
      value.reconnects++;
    },
    status: {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
    },
    projects: async () => [
      {
        projectId: `${label}-project`,
        projectDisplayName: label,
        projectRootPath: `/${label}`,
        projectKind: "git",
      },
    ],
    actions: {
      ...NO_PROJECT_ACTIONS,
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => {
        throw Error("Unexpected");
      },
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      openFile: async () => {
        throw Error("Unexpected");
      },
      renameWorkspace: async () => {},
      renameTab: async () => {},
      closeTab: async () => {},
      archiveWorkspace: async () => {},
    },
    catalog: {
      providers: async () => [],
      models: async () => [],
      modes: async () => [],
      onProvidersChange: () => () => {},
    },
    async close() {
      value.set({ status: "disposed" });
      closed.push(label);
    },
  };
  lives.set(label, [...(lives.get(label) ?? []), value]);
  return value;
}
function manualSchedule() {
  const pending: { run(): void; ms: number; cancelled: boolean }[] = [];
  return {
    schedule(run: () => void, ms: number) {
      const timer = { run, ms, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    delays: () => pending.filter((t) => !t.cancelled).map((t) => t.ms),
    async fire() {
      const timer = pending.find((t) => !t.cancelled);
      if (!timer) throw Error("Nothing scheduled");
      timer.cancelled = true;
      timer.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
async function setup(
  unreachable = new Set<string>(),
  /** Holds every connection attempt until it settles. */
  gate: Promise<unknown> = Promise.resolve(),
) {
  const registry = await loadHostRegistry(memory(), "hosts.json");
  await registry.add({
    connection: "build:6767",
    label: "Build",
    password: "build-pw",
  });
  const opened: HostTarget[] = [];
  const passwords: (string | null)[] = [];
  const closed: string[] = [];
  const timers = manualSchedule();
  lives.clear();
  const hosts = createHosts({
    schedule: timers.schedule,
    now: () => 1000,
    initial: {
      target: { kind: "home", home: "/home/.paseo" },
      live: live("local (127.0.0.1:6767)", closed),
    },
    registry,
    async open(target, label, password) {
      opened.push(target);
      passwords.push(password);
      await gate;
      if (target.kind === "host" && unreachable.has(target.connection))
        throw Error(`Cannot connect to ${target.connection}`);
      return live(
        label ?? (target.kind === "host" ? target.connection : "?"),
        closed,
      );
    },
  });
  return { hosts, registry, opened, closed, passwords, timers };
}

it("connects to every host at startup and publishes each one once it is up", async () => {
  const { hosts, opened } = await setup();
  await hosts.ready();
  expect(hosts.port.list()).toEqual([
    {
      id: "home:/home/.paseo",
      label: "local",
      detail: "local (127.0.0.1:6767)",
      status: "connected",
    },
    {
      id: "host:tcp://build:6767",
      label: "Build",
      detail: "tcp://build:6767",
      status: "connected",
    },
  ]);
  expect(opened).toEqual([{ kind: "host", connection: "build:6767" }]);
  expect(
    hosts.getSnapshot().map((host) => [host.id, host.label, host.live.label]),
  ).toEqual([
    ["home:/home/.paseo", "local", "local (127.0.0.1:6767)"],
    ["host:tcp://build:6767", "Build", "Build"],
  ]);
  const scope = hosts.port.scope("host:tcp://build:6767");
  expect(scope.label).toBe("Build");
  expect((await scope.projects()).map((p) => p.projectRootPath)).toEqual([
    "/Build",
  ]);
  expect(opened).toHaveLength(1);
});

it("saves a new host only after connecting to it", async () => {
  const { hosts, registry } = await setup(new Set(["down:6767"]));
  await hosts.ready();
  await expect(
    hosts.port.add({ connection: "down:6767", label: null, password: null }),
  ).rejects.toThrow("Cannot connect to down:6767");
  expect(registry.list().map((host) => host.connection)).toEqual([
    "build:6767",
  ]);
  const added = await hosts.port.add({
    connection: " gpu:6767 ",
    label: "GPU",
    password: null,
  });
  expect(added).toMatchObject({
    id: "host:tcp://gpu:6767",
    label: "GPU",
    status: "connected",
  });
  expect(registry.list().map((host) => host.connection)).toEqual([
    "build:6767",
    "gpu:6767",
  ]);
  expect(hosts.getSnapshot().map((host) => host.label)).toEqual([
    "local",
    "Build",
    "GPU",
  ]);
  await expect(
    hosts.port.add({ connection: "build:6767", label: null, password: null }),
  ).rejects.toThrow("build:6767 is already saved");
});

it("retries an unreachable host and closes every connection on exit", async () => {
  const unreachable = new Set(["build:6767"]);
  const { hosts, opened, closed } = await setup(unreachable);
  await hosts.ready();
  expect(hosts.port.list()[1]?.status).toBe("offline");
  expect(hosts.getSnapshot()).toHaveLength(1);
  unreachable.clear();
  await hosts.port.connect("host:tcp://build:6767");
  expect(opened).toHaveLength(2);
  expect(hosts.getSnapshot()).toHaveLength(2);
  await hosts.close();
  expect(closed.sort()).toEqual(["Build", "local (127.0.0.1:6767)"]);
});

it("never shows a password from a host's address", async () => {
  const { hosts } = await setup();
  await hosts.ready();
  const added = await hosts.port.add({
    connection: "tcp://gpu:6767?password=hunter2",
    label: null,
    password: null,
  });
  expect(added.label).toBe("tcp://gpu:6767");
  expect(added.detail).toBe("tcp://gpu:6767");
  expect(JSON.stringify(hosts.port.list())).not.toContain("hunter2");
  const ssh = await hosts.port.add({
    connection: "ssh://me@box?password=hunter2",
    label: "Box",
    password: null,
  });
  expect(ssh.detail).toBe("ssh://box (daemon port 6767)");
});

it("connects to each saved host with its own password, also when one is added", async () => {
  const { hosts, registry, passwords } = await setup();
  await hosts.ready();
  expect(passwords).toEqual(["build-pw"]);
  await hosts.port.add({
    connection: "tcp://gpu:6767?password=from-address",
    label: null,
    password: null,
  });
  await hosts.port.add({
    connection: "box:6767",
    label: "Box",
    password: "typed",
  });
  expect(passwords).toEqual(["build-pw", "from-address", "typed"]);
  expect(
    registry.list().map((host) => [host.connection, host.password]),
  ).toEqual([
    ["build:6767", "build-pw"],
    ["tcp://gpu:6767", "from-address"],
    ["box:6767", "typed"],
  ]);
});

const BUILD = "host:tcp://build:6767";
function healthOf(
  hosts: Awaited<ReturnType<typeof setup>>["hosts"],
  id: string,
) {
  return hosts.health.getSnapshot().find((entry) => entry.id === id);
}

it("retries a host that failed to connect on a 5 s, 10 s, 30 s, 60 s backoff", async () => {
  const unreachable = new Set(["build:6767"]);
  const { hosts, opened, timers } = await setup(unreachable);
  await hosts.ready();
  expect(healthOf(hosts, BUILD)).toEqual({
    id: BUILD,
    label: "Build",
    health: {
      kind: "offline",
      since: 1000,
      lastError: "Cannot connect to build:6767",
      nextRetryAt: 6000,
    },
    version: null,
  });
  expect(timers.delays()).toEqual([5000]);
  await timers.fire();
  expect(opened).toHaveLength(2);
  expect(timers.delays()).toEqual([10000]);
  await timers.fire();
  await timers.fire();
  expect(timers.delays()).toEqual([60000]);
  unreachable.clear();
  await timers.fire();
  expect(hosts.getSnapshot().map((host) => host.label)).toEqual([
    "local",
    "Build",
  ]);
  expect(healthOf(hosts, BUILD)).toMatchObject({
    health: { kind: "connected" },
    version: "Build-1.0",
  });
  expect(timers.delays()).toEqual([]);
});

it("retries immediately and restarts the backoff when the user connects a host", async () => {
  const unreachable = new Set(["build:6767"]);
  const { hosts, opened, timers } = await setup(unreachable);
  await hosts.ready();
  await timers.fire();
  expect(timers.delays()).toEqual([10000]);
  await expect(hosts.port.connect(BUILD)).rejects.toThrow(
    "Cannot connect to build:6767",
  );
  expect(opened).toHaveLength(3);
  expect(timers.delays()).toEqual([5000]);
});

it("leaves a dropped host to the client library while it retries, keeping its workspaces", async () => {
  const { hosts, timers } = await setup();
  await hosts.ready();
  const build = lives.get("Build")?.[0];
  if (!build) throw Error("Build not opened");
  const before = hosts.getSnapshot();
  build.set({
    status: "disconnected",
    reason: "Transport closed",
    nextRetryAt: new Date(2500).toISOString(),
  });
  expect(healthOf(hosts, BUILD)?.health).toEqual({
    kind: "offline",
    since: 1000,
    lastError: "Transport closed",
    nextRetryAt: 2500,
  });
  expect(hosts.port.list()[1]?.status).toBe("offline");
  expect(hosts.getSnapshot()).not.toBe(before);
  expect(hosts.getSnapshot().map((host) => host.live)).toEqual(
    before.map((host) => host.live),
  );
  expect(hosts.getSnapshot()[1]).toBe(before[1]);
  expect(timers.delays()).toEqual([]);
  await hosts.port.connect(BUILD);
  expect(build.reconnects).toBe(1);
  build.set({ status: "connected" });
  expect(healthOf(hosts, BUILD)?.health).toEqual({ kind: "connected" });
});

it("reconnects a host whose client stopped retrying, swapping in the new connection", async () => {
  const { hosts, opened, closed, timers } = await setup();
  await hosts.ready();
  const old = lives.get("Build")?.[0];
  if (!old) throw Error("Build not opened");
  old.set({ status: "disconnected", reason: "Paseo rejected the password" });
  expect(healthOf(hosts, BUILD)?.health).toMatchObject({
    kind: "offline",
    nextRetryAt: 6000,
  });
  expect(hosts.getSnapshot()[1]?.live).toBe(old);
  old.set({ status: "disposed" });
  expect(timers.delays()).toEqual([5000]);
  const firing = timers.fire();
  expect(hosts.getSnapshot()[1]?.live).toBe(old);
  await firing;
  expect(opened).toHaveLength(2);
  const replacement = lives.get("Build")?.[1];
  expect(hosts.getSnapshot()[1]?.live).toBe(replacement);
  expect(closed).toEqual(["Build"]);
  expect(healthOf(hosts, BUILD)?.health).toEqual({ kind: "connected" });
  await hosts.close();
  expect(timers.delays()).toEqual([]);
});

it("schedules no retry for a connection that fails after exit", async () => {
  let fail = () => {};
  const gate = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const { hosts, timers } = await setup(new Set(["build:6767"]), gate);
  await hosts.close();
  fail();
  await hosts.ready();
  expect(timers.delays()).toEqual([]);
});

it("cancels its own retry when the client library starts retrying again", async () => {
  const { hosts, opened, timers } = await setup();
  await hosts.ready();
  const build = lives.get("Build")?.[0];
  if (!build) throw Error("Build not opened");
  build.set({ status: "disconnected", reason: "Transport closed" });
  expect(timers.delays()).toEqual([5000]);
  build.set({ status: "connecting", attempt: 1 });
  expect(timers.delays()).toEqual([]);
  build.set({ status: "connected" });
  expect(opened).toHaveLength(1);
  expect(healthOf(hosts, BUILD)?.health).toEqual({ kind: "connected" });
});
