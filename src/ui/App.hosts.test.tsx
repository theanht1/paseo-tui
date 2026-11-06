import { expect, it } from "vitest";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";
import type { HostOption, HostsPort } from "./hosts/hosts.js";
import type { DirectorySnapshot } from "./workspace/workspace-directory.js";

function fakeHosts() {
  const connects: string[] = [];
  const added: unknown[] = [];
  const hosts: HostOption[] = [
    {
      id: "home",
      label: "local",
      detail: "local (127.0.0.1:6767)",
      status: "connected",
    },
    {
      id: "build",
      label: "Build",
      detail: "build:6767",
      status: "offline",
    },
  ];
  const port: HostsPort = {
    list: () => hosts,
    scope: () => {
      throw Error("Unexpected scope");
    },
    async add(input) {
      added.push(input);
      return {
        id: "new",
        label: input.label ?? input.connection,
        detail: input.connection,
        status: "connected",
      };
    },
    async connect(id) {
      connects.push(id);
    },
  };
  return { port, connects, added };
}
function management(added: string[]): NonNullable<AppProps["management"]> {
  return {
    ...NO_PROJECT_ACTIONS,
    directories: async (query) => [`/src/${query}`, `/src/${query}-api`],
    addProject: async (cwd) => {
      added.push(cwd);
      return {
        projectId: "new",
        projectDisplayName: "app",
        projectRootPath: cwd,
        projectKind: "git",
      };
    },
    baseBranches: async () => ({ branches: [], defaultBranch: null }),
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    openFile: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
}
async function palette(
  app: Awaited<ReturnType<typeof setup>>["app"],
  ...keys: string[]
) {
  for (const key of ["\u000b", ...keys]) {
    app.stdin.write(key);
    await settle();
  }
}

it("lists hosts with their status from the Command Center and reconnects an offline one", async () => {
  const { port, connects } = fakeHosts();
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { hosts: port },
  );
  await palette(app, "hosts", "\r");
  expect(app.lastFrame()).toContain("Hosts › Host");
  expect(app.lastFrame()).toContain("build:6767 · offline");
  for (const key of ["Build", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "Connected to Build");
  expect(connects).toEqual(["build"]);
});

it("adds a project by searching directories on the only connected host", async () => {
  const { port } = fakeHosts();
  const added: string[] = [];
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    management(added),
    undefined,
    { hosts: port },
  );
  await palette(app, "add project", "\r");
  expect(app.lastFrame()).toContain("Add project › Directory");
  app.stdin.write("app");
  await settleUntil(app.lastFrame, "/src/app-api");
  app.stdin.write("\r");
  await settle();
  expect(added).toEqual(["/src/app"]);
  await settleUntil(app.lastFrame, "Added project app");
});

it("tags each workspace in the sidebar with its host on the same row", async () => {
  const workspace = (id: string) => ({
    id,
    projectId: "repo",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    name: `/repo/${id}`,
  });
  const merged: DirectorySnapshot = {
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
        ["one", "local"],
        ["two", "build-server-eu"],
      ]),
      placements: new Map(),
    },
  };
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { directory: { subscribe: () => () => {}, getSnapshot: () => merged } },
  );
  const rows = app.lastFrame().split("\n");
  expect(rows.find((line) => line.includes("/repo/one"))).toMatch(
    /\/repo\/one\s+local\s/,
  );
  expect(rows.find((line) => line.includes("/repo/two"))).toMatch(
    /\/repo\/two\s+build-ser…/,
  );
});

it("hides the password as it is typed or pasted when adding a host", async () => {
  const { port, added } = fakeHosts();
  const { app, test } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { hosts: port },
  );
  await palette(app, "add host", "\r", "gpu:6767", "\r", "GPU", "\r");
  expect(app.lastFrame()).toContain("Add host › Address › Name › Password");
  expect(app.lastFrame()).toContain("PASEO_PASSWORD");
  for (const key of ["a", "b", "c"]) {
    app.stdin.write(key);
    await settle();
  }
  await test.mockInput.pasteBracketedText("def\n");
  await settle();
  expect(app.lastFrame()).toContain("••••••▌");
  expect(app.lastFrame()).not.toContain("abc");
  app.stdin.write("\u007f");
  await settle();
  expect(app.lastFrame()).toContain("•••••▌");
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Added host GPU");
  expect(added).toEqual([
    { connection: "gpu:6767", label: "GPU", password: "abcde" },
  ]);
});

it("types into Add host's address right away when opened from a chat pane", async () => {
  const { port, added } = fakeHosts();
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { hosts: port },
  );
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  await palette(app, "add host", "\r");
  await settle();
  for (const key of ["g", "p", "u"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Add host › Address");
  expect(app.lastFrame()).toMatch(/gpu/);
  expect(added).toEqual([]);
});

it("requires the address and the name before moving on", async () => {
  const { port, added } = fakeHosts();
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { hosts: port },
  );
  await palette(app, "add host", "\r");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("Address is required");
  expect(app.lastFrame()).not.toContain("› Name");
  for (const key of ["gpu:6767", "\r", "  ", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Name is required");
  expect(app.lastFrame()).not.toContain("› Password");
  for (const key of ["\u0015", "GPU", "\r", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "Added host GPU");
  expect(added).toEqual([
    { connection: "gpu:6767", label: "GPU", password: null },
  ]);
});
