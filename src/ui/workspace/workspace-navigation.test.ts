import { expect, it } from "vitest";
import { at } from "../../test/at.js";
import { agent } from "../../test/fixtures.js";
import { workspaceTabs } from "./workspaces.js";

const main = {
  id: "main",
  projectId: "repo",
  projectRootPath: "/repo",
  name: "Main",
  workspaceDirectory: "/repo",
};
const branch = {
  ...main,
  id: "branch",
  name: "Branch",
  workspaceDirectory: "/trees/branch",
};
it("remembers each workspace tab, selects empty workspaces, and moves the cursor independently", async () => {
  const { createWorkspaceNavigation } = await import(
    "./workspace-navigation.js"
  );
  const nav = createWorkspaceNavigation();
  const agents = [
    agent("a", { workspaceId: "main" }),
    agent("b", { workspaceId: "main" }),
    agent("c", { workspaceId: "branch" }),
  ];
  nav.selectWorkspace(main, agents, []);
  const beta = at(workspaceTabs("main", agents, []), 1);
  nav.selectTab(beta);
  nav.selectWorkspace(branch, agents, []);
  expect(nav.selectWorkspace(main, agents, [])?.key).toBe("agent:b");
  nav.moveCursor([main, branch], 1);
  expect(nav.getSnapshot().cursorId).toBe("branch");
  expect(nav.getSnapshot().workspaceId).toBe("main");
  expect(nav.selectWorkspace({ ...main, id: "empty" }, agents, [])).toBeNull();
  expect(nav.getSnapshot().tab).toBeNull();
});

it("selects the neighboring workspace after archive and clears its stale tabs", async () => {
  const { createWorkspaceNavigation } = await import(
    "./workspace-navigation.js"
  );
  const nav = createWorkspaceNavigation();
  const third = { ...main, id: "third" };
  const agents = [
    agent("a", { workspaceId: "main" }),
    agent("b", { workspaceId: "branch" }),
    agent("c", { workspaceId: "third" }),
  ];
  nav.reconcile([main, branch, third], agents, []);
  nav.selectWorkspace(branch, agents, []);
  nav.reconcile([main, third], agents, []);
  expect(nav.getSnapshot()).toMatchObject({
    workspaceId: "third",
    cursorId: "third",
    tab: { key: "agent:c" },
  });
  nav.reconcile([main], agents, []);
  expect(nav.getSnapshot()).toMatchObject({
    workspaceId: "main",
    tab: { key: "agent:a" },
  });
  nav.reconcile([], agents, []);
  expect(nav.getSnapshot()).toEqual({
    workspaceId: null,
    cursorId: null,
    tab: null,
  });
});

it("moves off an archived agent tab while retaining its workspace", async () => {
  const { createWorkspaceNavigation } = await import(
    "./workspace-navigation.js"
  );
  const nav = createWorkspaceNavigation();
  const agents = [
    agent("a", { workspaceId: "main" }),
    agent("b", { workspaceId: "main" }),
  ];
  nav.selectWorkspace(main, agents, []);
  nav.reconcile([main], agents.slice(1), []);
  expect(nav.getSnapshot()).toMatchObject({
    workspaceId: "main",
    tab: { key: "agent:b" },
  });
});

it("retains a newly created workspace and pending tab until the directory catches up", async () => {
  const { createWorkspaceNavigation } = await import(
    "./workspace-navigation.js"
  );
  const nav = createWorkspaceNavigation();
  const created = { ...branch, id: "new" };
  const pendingAgent = agent("created", { workspaceId: created.id });
  nav.reconcile([main], [], []);
  nav.selectTab({ kind: "agent", key: "agent:created", agent: pendingAgent });
  nav.reconcile([main], [], []);
  nav.reconcile([main], [], []);
  expect(nav.getSnapshot()).toMatchObject({
    workspaceId: "new",
    cursorId: "new",
    tab: { key: "agent:created" },
  });
  expect(nav.isWorkspaceRemoved("new")).toBe(false);
  nav.reconcile([main, created], [pendingAgent], []);
  nav.reconcile([main], [pendingAgent], []);
  expect(nav.isWorkspaceRemoved("new")).toBe(true);
  expect(nav.getSnapshot()).toEqual({
    workspaceId: "main",
    cursorId: "main",
    tab: null,
  });
  nav.reconcile([main, created], [pendingAgent], []);
  expect(nav.isWorkspaceRemoved("new")).toBe(false);
});

it("reconciles pane assignments after archive while preserving pending creation", async () => {
  const { reconcileWorkspaceLayout } = await import(
    "./workspace-navigation.js"
  );
  const { assign, initialLayout, panes, split } = await import(
    "../layout/split-tree.js"
  );
  const old = agent("a", { workspaceId: "main" });
  const neighbor = agent("b", { workspaceId: "branch" });
  const layout = assign(
    split(assign(initialLayout(), old.id), "right"),
    "pending",
  );
  const context = {
    agents: [old, neighbor],
    tab: { kind: "agent" as const, key: "agent:b", agent: neighbor },
    pendingAgentIds: new Set(["pending"]),
    isWorkspaceRemoved: (id: string) => id === "main",
  };
  const pending = reconcileWorkspaceLayout(layout, context);
  expect(panes(pending).map((pane) => pane.agentId)).toEqual([null, "pending"]);
  const completed = reconcileWorkspaceLayout(pending, {
    ...context,
    pendingAgentIds: new Set<string>(),
  });
  expect(panes(completed).map((pane) => pane.agentId)).toEqual([null, "b"]);
});

it("returns to the tab an editor terminal was opened from once its terminal exits", async () => {
  const { createWorkspaceNavigation } = await import(
    "./workspace-navigation.js"
  );
  const nav = createWorkspaceNavigation();
  const agents = [
    agent("a", { workspaceId: "main" }),
    agent("b", { workspaceId: "main" }),
  ];
  const vim = { id: "vim", workspaceId: "main", cwd: "/repo", name: "a.ts" };
  nav.reconcile([main], agents, []);
  const beta = at(workspaceTabs("main", agents, []), 1);
  if (!beta) throw Error("missing tab");
  nav.selectTab(beta);
  nav.selectTab(
    { kind: "terminal", key: "terminal:vim", terminal: vim },
    beta.key,
  );
  nav.reconcile([main], agents, [vim]);
  expect(nav.getSnapshot().tab?.key).toBe("terminal:vim");
  nav.reconcile([main], agents, []);
  expect(nav.getSnapshot().tab?.key).toBe("agent:b");
});
