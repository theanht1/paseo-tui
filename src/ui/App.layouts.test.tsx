import { expect, it } from "vitest";
import { agents, settle, setup } from "../test/app-harness.js";
import { BINDINGS } from "./input/bindings.js";
import { applyKeyOverrides } from "./input/key-overrides.js";
import { loadLayoutMemory } from "./layout/layout-memory.js";

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

async function press(
  app: { stdin: { write(input: string): void } },
  keys: string[],
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

it("keeps each workspace's split, and restores it after a restart", async () => {
  const file = memoryFile();
  const layouts = await loadLayoutMemory(file, manual);
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { layouts },
  );
  // Open workspace one, split right, show beta in the new pane: alpha | beta.
  await press(app, ["\r", "\u0002", "%", "g", "t"]);
  expect(app.lastFrame()).toContain("hello alpha");
  expect(app.lastFrame()).toContain("hello beta");
  // Workspace two shows gamma; zoom it there.
  await press(app, ["]", "\u0002", "z"]);
  expect(app.lastFrame()).toContain("hello gamma");
  expect(app.lastFrame()).not.toContain("hello alpha");
  // Back in one, its unzoomed split returns.
  await press(app, ["["]);
  expect(app.lastFrame()).toContain("hello alpha");
  expect(app.lastFrame()).toContain("hello beta");
  // And two is still zoomed.
  await press(app, ["]"]);
  expect(app.lastFrame()).toContain("hello gamma");
  expect(app.lastFrame()).not.toContain("hello alpha");
  await press(app, ["["]);
  await layouts.flush();

  const restarted = await loadLayoutMemory(memoryFile(file.contents), manual);
  const second = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { layouts: restarted },
  );
  await press(second.app, ["\r"]);
  expect(second.app.lastFrame()).toContain("hello alpha");
  expect(second.app.lastFrame()).toContain("hello beta");
});

it("drops restored panes whose agents no longer exist", async () => {
  const file = memoryFile();
  const layouts = await loadLayoutMemory(file, manual);
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { layouts },
  );
  await press(app, ["\r", "\u0002", "%", "g", "t"]);
  await layouts.flush();
  const restarted = await loadLayoutMemory(memoryFile(file.contents), manual);
  const second = await setup(
    agents.filter((agent) => agent.id !== "beta"),
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { layouts: restarted },
  );
  await press(second.app, ["\r"]);
  expect(second.app.lastFrame()).toContain("hello alpha");
  expect(second.app.lastFrame()).not.toContain("hello beta");
});

it("runs rebound keys and shows them in the shortcut help", async () => {
  const { bindings, errors } = applyKeyOverrides(
    BINDINGS,
    new Map([
      ["sidebar.toggle", ["|"]],
      ["help", ["F1"]],
    ]),
  );
  expect(errors).toEqual([]);
  const { app } = await setup(
    agents,
    40,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { bindings },
  );
  await press(app, ["\\"]);
  expect(app.lastFrame()).toContain("/repo/one");
  await press(app, ["|"]);
  expect(app.lastFrame()).not.toContain("/repo/one");
  await press(app, ["|", "\u001bOP"]);
  expect(app.lastFrame()).toContain("Keyboard shortcuts");
  expect(app.lastFrame()).toContain(" | ");
});

it("separates sidebar workspaces with a rule and keeps a blank row above the prompt", async () => {
  const { app } = await setup(agents, 30);
  await press(app, ["\r"]);
  const rows = app.lastFrame().split("\n");
  const one = rows.findIndex((row) => row.includes("/repo/one"));
  const two = rows.findIndex((row) => row.includes("/repo/two"));
  expect(two - one).toBe(2);
  expect(rows[one + 1]?.slice(1, 33)).toMatch(/^ *─+ *$/);
  const prompt = rows.findIndex((row) => row.includes("Press i or a"));
  expect(rows[prompt - 1]?.slice(36)).toMatch(/^│ +│ *$/);
});

it("separates sidebar sections with a full-width rule", async () => {
  const harness = await setup(agents, 30);
  harness.updateWorkspace("two", { pinnedAt: "2026-11-06T00:00:10Z" });
  await settle();
  const rows = harness.app.lastFrame().split("\n");
  const project = rows.findIndex((row) => row.startsWith("│Repo"));
  expect(rows.findIndex((row) => row.startsWith("│Pinned"))).toBeLessThan(
    project,
  );
  expect(rows[project - 1]?.slice(1, 33)).toMatch(/^─{32}$/);
});
