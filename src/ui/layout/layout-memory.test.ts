import { expect, test } from "vitest";
import { layoutsPath, loadLayoutMemory, pruneLayout } from "./layout-memory.js";
import {
  assign,
  initialLayout,
  type Layout,
  panes,
  split,
  toggleZoom,
} from "./split-tree.js";

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
/** A manual timer: `run()` fires whatever is scheduled. */
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
/** alpha | beta, beta focused and zoomed. */
function twoPanes(): Layout {
  return toggleZoom(
    assign(split(assign(initialLayout(), "alpha"), "right"), "beta"),
  );
}
const live = new Set(["alpha", "beta"]);

test("state lives under XDG_STATE_HOME, else ~/.local/state", () => {
  expect(layoutsPath({ XDG_STATE_HOME: "/s" }, "/home/me")).toBe(
    "/s/paseo-tui/layouts.json",
  );
  expect(layoutsPath({}, "/home/me")).toBe(
    "/home/me/.local/state/paseo-tui/layouts.json",
  );
});

test("restores a recorded split, pane agents, zoom and tab after a restart", async () => {
  const timer = scheduler();
  const first = storage();
  const memory = await loadLayoutMemory(first, timer);
  memory.record("one", twoPanes(), "agent:beta");
  expect(first.writes).toEqual([]);
  expect(timer.scheduled).toBe(true);
  timer.run();
  await memory.flush();
  expect(first.writes).toHaveLength(1);

  const reopened = await loadLayoutMemory(
    storage(first.writes[0] ?? null),
    scheduler(),
  );
  expect(reopened.tabs()).toEqual(new Map([["one", "agent:beta"]]));
  expect(reopened.restore("one", { agentIds: live, tabAgentId: null })).toEqual(
    twoPanes(),
  );
  expect(reopened.restore("two", { agentIds: live, tabAgentId: null })).toBe(
    null,
  );
});

test("flush writes a pending change at once and skips unchanged records", async () => {
  const timer = scheduler();
  const file = storage();
  const memory = await loadLayoutMemory(file, timer);
  memory.record("one", twoPanes(), "agent:beta");
  await memory.flush();
  expect(file.writes).toHaveLength(1);
  expect(timer.scheduled).toBe(false);
  memory.record("one", twoPanes(), "agent:beta");
  expect(timer.scheduled).toBe(false);
  await memory.flush();
  expect(file.writes).toHaveLength(1);
});

test("restoring drops panes whose agents are gone and shows the opened tab", async () => {
  const memory = await loadLayoutMemory(storage(), scheduler());
  memory.record("one", twoPanes(), "agent:beta");
  const alone = memory.restore("one", {
    agentIds: new Set(["alpha"]),
    tabAgentId: null,
  });
  expect(alone && panes(alone).map((pane) => pane.agentId)).toEqual(["alpha"]);
  expect(alone?.zoomedId).toBeNull();
  expect(alone?.focusedId).toBe(alone && panes(alone)[0]?.id);

  const focused = memory.restore("one", {
    agentIds: live,
    tabAgentId: "alpha",
  });
  expect(focused?.focusedId).toBe("0");
  const assigned = memory.restore("one", {
    agentIds: new Set([...live, "gamma"]),
    tabAgentId: "gamma",
  });
  expect(assigned && panes(assigned).map((pane) => pane.agentId)).toEqual([
    "alpha",
    "gamma",
  ]);
});

test("pruning every pane leaves one empty pane with a fresh id", () => {
  const layout = pruneLayout(twoPanes(), new Set());
  expect(panes(layout)).toEqual([{ kind: "pane", id: "2", agentId: null }]);
  expect(layout.focusedId).toBe("2");
  expect(layout.nextId).toBe(3);
});

test("ignores malformed state files and entries", async () => {
  const valid = { layout: twoPanes(), tab: "agent:beta" };
  const memory = await loadLayoutMemory(
    storage(
      JSON.stringify({
        version: 1,
        workspaces: {
          one: valid,
          bad: { layout: { root: { kind: "pane" } }, tab: 3 },
        },
      }),
    ),
    scheduler(),
  );
  expect(memory.tabs()).toEqual(new Map([["one", "agent:beta"]]));
  expect(memory.restore("bad", { agentIds: live, tabAgentId: null })).toBe(
    null,
  );
  for (const text of ["{", "[]", '{"version":2,"workspaces":{}}']) {
    const empty = await loadLayoutMemory(storage(text), scheduler());
    expect(empty.tabs()).toEqual(new Map());
  }
});
