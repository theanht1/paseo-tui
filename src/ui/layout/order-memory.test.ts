import { expect, test } from "vitest";
import { loadOrderMemory, orderPath } from "./order-memory.js";

function storage(initial: string | null = null) {
  const writes: string[] = [];
  return {
    writes,
    async read() {
      return initial;
    },
    async write(contents: string) {
      writes.push(contents);
    },
  };
}
function scheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule(run: () => void) {
      pending = run;
      return () => {
        pending = null;
      };
    },
    get scheduled() {
      return pending !== null;
    },
    run() {
      const run = pending;
      pending = null;
      run?.();
    },
  };
}

test("order lives under XDG_STATE_HOME, else ~/.local/state", () => {
  expect(orderPath({ XDG_STATE_HOME: "/s" }, "/home/me")).toBe(
    "/s/paseo-tui/order.json",
  );
  expect(orderPath({}, "/home/me")).toBe(
    "/home/me/.local/state/paseo-tui/order.json",
  );
});

test("keeps project, workspace, tab and pinned orders across a restart, writing once per burst", async () => {
  const timer = scheduler();
  const file = storage();
  const memory = await loadOrderMemory(file, timer);
  let changes = 0;
  memory.subscribe(() => changes++);
  memory.apply({ kind: "projects", keys: ["b", "a"] });
  memory.apply({ kind: "workspaces", projectKey: "a", keys: ["w2", "w1"] });
  memory.apply({ kind: "tabs", workspaceKey: "w1", keys: ["terminal:t"] });
  memory.apply({ kind: "pinned", keys: ["w2", "w9"] });
  expect(changes).toBe(4);
  expect(memory.getSnapshot().projects).toEqual(["b", "a"]);
  expect(file.writes).toEqual([]);
  expect(timer.scheduled).toBe(true);
  timer.run();
  await memory.flush();
  expect(file.writes).toHaveLength(1);

  const reopened = await loadOrderMemory(
    storage(file.writes[0] ?? null),
    scheduler(),
  );
  expect(reopened.getSnapshot()).toEqual({
    projects: ["b", "a"],
    workspaces: new Map([["a", ["w2", "w1"]]]),
    tabs: new Map([["w1", ["terminal:t"]]]),
    pinned: ["w2", "w9"],
  });
});

test("an unchanged order neither notifies nor writes", async () => {
  const timer = scheduler();
  const memory = await loadOrderMemory(
    storage(JSON.stringify({ version: 1, projects: ["a"] })),
    timer,
  );
  let changes = 0;
  memory.subscribe(() => changes++);
  memory.apply({ kind: "projects", keys: ["a"] });
  expect(changes).toBe(0);
  expect(timer.scheduled).toBe(false);
});

test("flush writes a pending change at once", async () => {
  const timer = scheduler();
  const file = storage();
  const memory = await loadOrderMemory(file, timer);
  memory.apply({ kind: "projects", keys: ["a"] });
  await memory.flush();
  expect(file.writes).toHaveLength(1);
  expect(timer.scheduled).toBe(false);
});

test("tolerates a missing, corrupt or partly invalid file", async () => {
  const empty = {
    projects: [],
    workspaces: new Map(),
    tabs: new Map(),
    pinned: [],
  };
  for (const text of [null, "{", "[]", JSON.stringify({ version: 2 })])
    expect(
      (await loadOrderMemory(storage(text), scheduler())).getSnapshot(),
    ).toEqual(empty);
  const partial = await loadOrderMemory(
    storage(
      JSON.stringify({
        version: 1,
        projects: ["a", 3, "b"],
        workspaces: { a: ["w1", null], b: "nope" },
        tabs: [],
        pinned: ["w1", 2],
      }),
    ),
    scheduler(),
  );
  expect(partial.getSnapshot()).toEqual({
    projects: ["a", "b"],
    workspaces: new Map([["a", ["w1"]]]),
    tabs: new Map(),
    pinned: ["w1"],
  });
});

test("keeps the tab orders of the most recently reordered workspaces", async () => {
  const timer = scheduler();
  const memory = await loadOrderMemory(storage(), { ...timer, limit: 2 });
  for (const workspace of ["w1", "w2", "w3"])
    memory.apply({ kind: "tabs", workspaceKey: workspace, keys: ["agent:x"] });
  expect([...memory.getSnapshot().tabs.keys()]).toEqual(["w2", "w3"]);
});
