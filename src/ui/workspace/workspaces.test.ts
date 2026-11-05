import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { cycleTab, projectTree, workspaceTabs } from "./workspaces.js";

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
  workspaceDirectory: "/repo",
};
const branch = {
  ...main,
  id: "branch",
  name: "Branch",
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
