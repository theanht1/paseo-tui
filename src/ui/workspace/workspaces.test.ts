import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { NO_ORDER, type StoredOrder } from "./ordering.js";
import {
  cycleTab,
  projectMove,
  projectTree,
  tabMove,
  workspaceMove,
  workspaceTabs,
} from "./workspaces.js";

const project = {
  projectId: "repo",
  projectDisplayName: "Repo",
  projectRootPath: "/repo",
  projectKind: "git" as const,
};
const main = {
  ...project,
  id: "main",
  name: "Main",
  activityAt: null,
  statusEnteredAt: null,
  workspaceDirectory: "/repo",
};
const branch = {
  ...main,
  id: "branch",
  name: "Branch",
  activityAt: null,
  statusEnteredAt: null,
  workspaceDirectory: "/trees/branch",
};
it("groups real workspace IDs under their project, including empty worktrees", () => {
  expect(projectTree([project], [main, branch])).toEqual([
    { project, workspaces: [main, branch] },
  ]);
});
it("tabs are scoped by workspace identity and include terminals", () => {
  const tabs = workspaceTabs(
    "main",
    [
      agent("a", { workspaceId: "main" }),
      agent("b", { workspaceId: "branch" }),
    ],
    [{ id: "shell", workspaceId: "main", cwd: "/repo", name: "Shell" }],
  );
  expect(tabs.map((t) => t.key)).toEqual(["agent:a", "terminal:shell"]);
  expect(cycleTab(tabs, "agent:a", -1)?.key).toBe("terminal:shell");
  expect(cycleTab(tabs, "terminal:shell", 1)?.key).toBe("agent:a");
  expect(cycleTab([], null, 1)).toBeNull();
});
it("agent tabs keep creation order when activity changes", () => {
  const a = agent("a", {
    workspaceId: "main",
    createdAt: "2026-11-01T00:00:01Z",
    updatedAt: "2026-11-01T00:00:09Z",
    status: "running",
  });
  const b = agent("b", {
    workspaceId: "main",
    createdAt: "2026-11-01T00:00:02Z",
    updatedAt: "2026-11-01T00:00:03Z",
  });
  const keys = (list: Parameters<typeof workspaceTabs>[1]) =>
    workspaceTabs("main", list, []).map((t) => t.key);
  expect(keys([a, b])).toEqual(["agent:a", "agent:b"]);
  expect(keys([b, a])).toEqual(["agent:a", "agent:b"]);
});
it("archived agents get one slot in creation order", () => {
  const live = agent("live", {
    workspaceId: "main",
    createdAt: "2026-11-01T00:00:02Z",
  });
  const old = agent("old", {
    workspaceId: "main",
    createdAt: "2026-11-01T00:00:01Z",
    archivedAt: "2026-11-02T00:00:00Z",
  });
  const other = agent("other", {
    workspaceId: "branch",
    archivedAt: "2026-11-02T00:00:00Z",
  });
  const tabs = workspaceTabs("main", [live, old], [], [], [old, other, live]);
  expect(tabs.map((t) => t.key)).toEqual(["agent:old", "agent:live"]);
});
const other = {
  projectId: "other",
  projectDisplayName: "Other",
  projectRootPath: "/other",
  projectKind: "git" as const,
};
const fresh = { ...main, id: "fresh", name: "Fresh" };
function order(patch: Partial<StoredOrder>): StoredOrder {
  return { ...NO_ORDER, ...patch };
}
it("orders projects by the stored order, appending new projects", () => {
  const third = { ...other, projectId: "third", projectDisplayName: "Third" };
  const tree = projectTree(
    [project, other, third],
    [],
    order({ projects: ["third", "repo"] }),
  );
  expect(tree.map((node) => node.project.projectId)).toEqual([
    "third",
    "repo",
    "other",
  ]);
});
it("orders workspaces within their project, prepending new workspaces", () => {
  const tree = projectTree(
    [project],
    [main, branch, fresh],
    order({ workspaces: new Map([["repo", ["branch", "main"]]]) }),
  );
  expect(tree[0]?.workspaces.map((workspace) => workspace.id)).toEqual([
    "fresh",
    "branch",
    "main",
  ]);
});
it("orders tabs by the stored order, appending new tabs", () => {
  const tabs = workspaceTabs(
    "main",
    [
      agent("a", { workspaceId: "main", createdAt: "2026-11-01T00:00:01Z" }),
      agent("b", { workspaceId: "main", createdAt: "2026-11-01T00:00:02Z" }),
    ],
    [{ id: "shell", workspaceId: "main", cwd: "/repo", name: "Shell" }],
    [],
    [],
    order({ tabs: new Map([["main", ["terminal:shell", "agent:a"]]]) }),
  );
  expect(tabs.map((tab) => tab.key)).toEqual([
    "terminal:shell",
    "agent:a",
    "agent:b",
  ]);
});
it("moving a workspace stores its project's visible order", () => {
  const tree = projectTree([project, other], [main, branch]);
  expect(workspaceMove(tree, NO_ORDER, "main", 1)).toEqual({
    kind: "workspaces",
    projectKey: "repo",
    keys: ["branch", "main"],
  });
  expect(workspaceMove(tree, NO_ORDER, "main", -1)).toBeNull();
});
it("moving a project stores the visible project order plus hidden stored ones", () => {
  const tree = projectTree([project, other], [main]);
  expect(projectMove(tree, order({ projects: ["gone"] }), "main", 1)).toEqual({
    kind: "projects",
    keys: ["other", "repo", "gone"],
  });
  expect(projectMove(tree, NO_ORDER, "main", -1)).toBeNull();
});
it("moving a tab stores the workspace's tab order", () => {
  const tabs = workspaceTabs(
    "main",
    [agent("a", { workspaceId: "main" })],
    [{ id: "shell", workspaceId: "main", cwd: "/repo", name: "Shell" }],
  );
  expect(tabMove(tabs, NO_ORDER, "main", "terminal:shell", -1)).toEqual({
    kind: "tabs",
    workspaceKey: "main",
    keys: ["terminal:shell", "agent:a"],
  });
  expect(tabMove(tabs, NO_ORDER, "main", "terminal:shell", 1)).toBeNull();
});
