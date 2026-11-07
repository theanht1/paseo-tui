import { expect, it } from "vitest";
import { settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import { loadOrderMemory } from "./layout/order-memory.js";
import type { DirectorySnapshot } from "./workspace/workspace-directory.js";

function memoryFile(initial: string | null = null) {
  let contents = initial;
  return {
    get contents() {
      return contents;
    },
    async read() {
      return contents;
    },
    async write(next: string) {
      contents = next;
    },
  };
}
const manual = { schedule: () => () => {} };
function inWorkspace(id: string, workspaceId: string, createdAt?: string) {
  return agent(id, {
    title: `${id} agent`,
    cwd: `/repo/${workspaceId}`,
    workspaceId,
    ...(createdAt ? { createdAt } : {}),
  });
}
const three = [
  inWorkspace("alpha", "one"),
  inWorkspace("beta", "two"),
  inWorkspace("gamma", "three"),
];
/** Command on macOS, Alt elsewhere. */
const jump = process.platform === "darwin" ? { super: true } : { meta: true };
type Test = Awaited<ReturnType<typeof setup>>["test"];
function y(test: Test, id: string) {
  return test.renderer.root.findDescendantById(`workspace:${id}`)?.y ?? -1;
}
function tabX(test: Test, key: string) {
  return test.renderer.root.findDescendantById(`tab:${key}`)?.x ?? -1;
}
async function press(
  app: { stdin: { write(input: string): void } },
  keys: string[],
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

it("moves workspaces with J / K, jumps by the new order, and keeps it after a restart", async () => {
  const file = memoryFile();
  const order = await loadOrderMemory(file, manual);
  const { app, test } = await setup(
    three,
    24,
    true,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      order,
    },
  );
  expect(y(test, "one")).toBeLessThan(y(test, "two"));
  await press(app, ["J", "J", "K"]);
  expect(y(test, "two")).toBeLessThan(y(test, "one"));
  expect(y(test, "one")).toBeLessThan(y(test, "three"));
  test.mockInput.pressKey("1", jump);
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  await order.flush();

  const restarted = await loadOrderMemory(memoryFile(file.contents), manual);
  const second = await setup(
    three,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      order: restarted,
    },
  );
  expect(y(second.test, "two")).toBeLessThan(y(second.test, "one"));
  expect(y(second.test, "one")).toBeLessThan(y(second.test, "three"));
});

it("moves the current tab with < / >, selects tabs by the new order, and keeps it after a restart", async () => {
  const tabs = [
    inWorkspace("alpha", "one", "2026-11-01T00:00:01Z"),
    inWorkspace("alpha2", "one", "2026-11-01T00:00:02Z"),
  ];
  const file = memoryFile();
  const order = await loadOrderMemory(file, manual);
  const { app, test } = await setup(
    tabs,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      order,
    },
  );
  await press(app, ["\r"]);
  expect(tabX(test, "agent:alpha")).toBeLessThan(tabX(test, "agent:alpha2"));
  await press(app, [">"]);
  expect(tabX(test, "agent:alpha2")).toBeLessThan(tabX(test, "agent:alpha"));
  await press(app, ["1"]);
  expect(app.lastFrame()).toContain("hello alpha2");
  await press(app, [">"]);
  expect(tabX(test, "agent:alpha")).toBeLessThan(tabX(test, "agent:alpha2"));
  await press(app, ["<"]);
  await order.flush();

  const restarted = await loadOrderMemory(memoryFile(file.contents), manual);
  const second = await setup(
    tabs,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    {
      order: restarted,
    },
  );
  await press(second.app, ["\r"]);
  expect(tabX(second.test, "agent:alpha2")).toBeLessThan(
    tabX(second.test, "agent:alpha"),
  );
  expect(second.app.lastFrame()).toContain("hello alpha2");
});

it("moves the project of the workspace under the cursor with { / }", async () => {
  const snapshot: DirectorySnapshot = {
    projects: ["Repo", "Other"].map((name) => ({
      projectId: name.toLowerCase(),
      projectDisplayName: name,
      projectRootPath: `/${name.toLowerCase()}`,
      projectKind: "git" as const,
    })),
    workspaces: ["one", "two"].map((id, index) => ({
      id,
      projectId: index === 0 ? "repo" : "other",
      projectRootPath: "/repo",
      activityAt: null,
      statusEnteredAt: null,
      workspaceDirectory: `/repo/${id}`,
      name: `/repo/${id}`,
    })),
    terminals: [],
    error: null,
  };
  const { app, test } = await setup(
    three.slice(0, 2),
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { directory: { subscribe: () => () => {}, getSnapshot: () => snapshot } },
  );
  expect(y(test, "one")).toBeLessThan(y(test, "two"));
  await press(app, ["J"]);
  expect(y(test, "one")).toBeLessThan(y(test, "two"));
  await press(app, ["}"]);
  expect(y(test, "two")).toBeLessThan(y(test, "one"));
  test.mockInput.pressKey("1", jump);
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  await press(app, ["\t", "j", "{"]);
  expect(y(test, "one")).toBeLessThan(y(test, "two"));
});

it("explains that moves need project grouping while grouped by status", async () => {
  const { app, test } = await setup(three);
  await press(app, ["S", "J"]);
  expect(app.lastFrame()).toContain("project grouping");
  await press(app, ["S"]);
  expect(y(test, "one")).toBeLessThan(y(test, "two"));
});
