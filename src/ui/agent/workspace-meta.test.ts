import { describe, expect, it } from "vitest";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { hostTag, setupTag, workspaceMeta } from "./workspace-meta.js";

const base: WorkspaceRow = {
  id: "w",
  projectId: "p",
  name: "Fix login",
  projectRootPath: "/p",
  workspaceDirectory: "/p",
};
function pr(
  overrides: Partial<{
    number: number;
    state: string;
    isMerged: boolean;
    isDraft: boolean;
    checksStatus: "none" | "pending" | "success" | "failure";
  }> = {},
) {
  return {
    githubRuntime: {
      pullRequest: {
        number: 42,
        url: "https://example.test/pr/42",
        title: "Fix login",
        state: "OPEN",
        baseRefName: "main",
        headRefName: "fix-login",
        isMerged: false,
        ...overrides,
      },
    },
  };
}

it("shows nothing for a plain directory workspace", () => {
  expect(workspaceMeta(base)).toBeNull();
});

it("summarizes branch, unpushed commits, diff size, and PR checks", () => {
  expect(
    workspaceMeta({
      ...base,
      gitRuntime: { currentBranch: "fix-login", aheadOfOrigin: 2 },
      diffStat: { additions: 12, deletions: 3 },
      ...pr({ checksStatus: "success" }),
    }),
  ).toBe("⎇ fix-login ↑2 · +12 −3 · #42 ✓");
  expect(workspaceMeta({ ...base, ...pr({ checksStatus: "failure" }) })).toBe(
    "#42 ✗",
  );
  expect(workspaceMeta({ ...base, ...pr({ checksStatus: "pending" }) })).toBe(
    "#42 …",
  );
  expect(workspaceMeta({ ...base, ...pr({ isDraft: true }) })).toBe(
    "#42 draft",
  );
  expect(workspaceMeta({ ...base, ...pr({ isMerged: true }) })).toBe(
    "#42 merged",
  );
});

it("omits the branch when the row is already named after it, and an empty diff", () => {
  expect(
    workspaceMeta({
      ...base,
      name: "fix-login",
      gitRuntime: { currentBranch: "fix-login" },
      diffStat: { additions: 0, deletions: 0 },
    }),
  ).toBeNull();
  expect(
    workspaceMeta({
      ...base,
      name: "fix-login",
      gitRuntime: { currentBranch: "fix-login", aheadOfOrigin: 1 },
    }),
  ).toBe("↑1");
});

it("tags worktree setup that is running, failed, or blocked, and nothing once it completes", () => {
  expect(setupTag({ ...base, setupStatus: "running" })).toEqual({
    text: "setup…",
    tone: "running",
  });
  expect(setupTag({ ...base, setupStatus: "failed" })).toEqual({
    text: "setup failed",
    tone: "error",
  });
  expect(setupTag({ ...base, setupStatus: "blocked" })).toEqual({
    text: "setup blocked",
    tone: "attention",
  });
  expect(setupTag({ ...base, setupStatus: "completed" })).toBeNull();
  expect(setupTag(base)).toBeNull();
});

describe("hostTag", () => {
  it("keeps a short host name and shortens a long one to an ellipsis", () => {
    expect(hostTag("local")).toBe("local");
    expect(hostTag("build-server-eu-west")).toBe("build-ser…");
    expect(hostTag("  GPU box ")).toBe("GPU box");
  });
});
