import type { ConnectionState } from "@getpaseo/client";
import { expect, it } from "vitest";
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
function live(label: string, closed: string[]): HostLive {
  let state: ConnectionState = { status: "connected" };
  return {
    label,
    status: {
      subscribe: () => () => {},
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
    },
    async close() {
      state = { status: "disposed" };
      closed.push(label);
    },
  };
}
async function setup(unreachable = new Set<string>()) {
  const registry = await loadHostRegistry(memory(), "hosts.json");
  await registry.add({
    connection: "build:6767",
    label: "Build",
    password: "build-pw",
  });
  const opened: HostTarget[] = [];
  const passwords: (string | null)[] = [];
  const closed: string[] = [];
  const hosts = createHosts({
    initial: {
      target: { kind: "home", home: "/home/.paseo" },
      live: live("local (127.0.0.1:6767)", closed),
    },
    registry,
    async open(target, label, password) {
      opened.push(target);
      passwords.push(password);
      if (target.kind === "host" && unreachable.has(target.connection))
        throw Error(`Cannot connect to ${target.connection}`);
      return live(
        label ?? (target.kind === "host" ? target.connection : "?"),
        closed,
      );
    },
  });
  return { hosts, registry, opened, closed, passwords };
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
