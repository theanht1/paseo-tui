import { expect, it } from "vitest";
import { NO_ORDER, type StoredOrder } from "../workspace/ordering.js";
import {
  type ProjectNode,
  projectTree,
  type WorkspaceRow,
} from "../workspace/workspaces.js";
import { filterProjects } from "./label-filter.js";
import {
  pinnedMove,
  type SidebarSection,
  sidebarSections,
  unpinnedOrder,
  unpinnedProjects,
} from "./sidebar-sections.js";

function row(
  id: string,
  projectId: string,
  pinnedAt: string | null = null,
): WorkspaceRow {
  return {
    id,
    activityAt: null,
    statusEnteredAt: null,
    projectId,
    name: id,
    projectRootPath: `/${projectId}`,
    workspaceDirectory: `/${projectId}`,
    pinnedAt,
  };
}
function project(projectId: string, workspaces: WorkspaceRow[]): ProjectNode {
  return {
    project: {
      projectId,
      projectDisplayName: projectId,
      projectRootPath: `/${projectId}`,
      projectKind: "git",
    },
    workspaces,
  };
}
function shape(sections: readonly SidebarSection[]) {
  return sections.map((section) => [
    section.key,
    section.workspaces.map((workspace) => workspace.id),
  ]);
}
const projects = [
  project("api", [
    row("a1", "api", "2026-11-01T00:00:00Z"),
    row("a2", "api", "2026-11-03T00:00:00Z"),
  ]),
  project("web", [row("w1", "web"), row("w2", "web", "2026-11-02T00:00:00Z")]),
];

it("puts pinned workspaces in a Pinned section on top, newest pin first, and keeps their emptied project", () => {
  expect(shape(sidebarSections(projects, new Map(), "project"))).toEqual([
    ["pinned", ["a2", "w2", "a1"]],
    ["project:api", []],
    ["project:web", ["w1"]],
  ]);
});

it("puts Pinned above the status groups, which leave pinned workspaces out", () => {
  const sections = sidebarSections(
    projects,
    new Map([
      ["a1", "running"],
      ["w1", "running"],
    ]),
    "status",
  );
  expect(shape(sections)).toEqual([
    ["pinned", ["a2", "w2", "a1"]],
    ["status:running", ["w1"]],
  ]);
});

it("orders pinned workspaces by the stored pinned order", () => {
  expect(
    shape(sidebarSections(projects, new Map(), "project", ["a1", "a2"]))[0],
  ).toEqual(["pinned", ["a1", "w2", "a2"]]);
});

it("applies the label filter to pinned workspaces too", () => {
  const labelled = [
    project("api", [
      { ...row("a1", "api", "2026-11-01T00:00:00Z"), labels: ["bug"] },
      row("a2", "api", "2026-11-03T00:00:00Z"),
      { ...row("a3", "api"), labels: ["bug"] },
    ]),
  ];
  expect(
    shape(
      sidebarSections(filterProjects(labelled, ["bug"]), new Map(), "project"),
    ),
  ).toEqual([
    ["pinned", ["a1"]],
    ["project:api", ["a3"]],
  ]);
});

it("has no Pinned section when nothing is pinned", () => {
  const plain = [project("web", [row("w1", "web")])];
  expect(shape(sidebarSections(plain, new Map(), "project"))).toEqual([
    ["project:web", ["w1"]],
  ]);
});

it("removes pinned workspaces from their projects", () => {
  expect(
    unpinnedProjects(projects).map((node) =>
      node.workspaces.map((workspace) => workspace.id),
    ),
  ).toEqual([[], ["w1"]]);
});

it("moving a pinned workspace stores the displayed pinned order", () => {
  const order: StoredOrder = { ...NO_ORDER, pinned: ["gone"] };
  expect(pinnedMove(projects, order, "a2", 1)).toEqual({
    kind: "pinned",
    keys: ["w2", "a2", "a1", "gone"],
  });
  expect(pinnedMove(projects, NO_ORDER, "a2", -1)).toBeNull();
  expect(pinnedMove(projects, NO_ORDER, "w1", 1)).toBeNull();
});

it("a project tree of pinned rows still lists the project", () => {
  const tree = projectTree(
    [project("api", []).project],
    [row("a1", "api", "2026-11-01T00:00:00Z")],
  );
  expect(shape(sidebarSections(tree, new Map(), "project"))).toEqual([
    ["pinned", ["a1"]],
    ["project:api", []],
  ]);
});

it("unpinning drops the workspace from the stored pinned order, so a re-pin goes back on top", () => {
  const order: StoredOrder = { ...NO_ORDER, pinned: ["a1", "w2", "a2"] };
  expect(unpinnedOrder(order, "w2")).toEqual({
    kind: "pinned",
    keys: ["a1", "a2"],
  });
  expect(unpinnedOrder(order, "w1")).toBeNull();
  const repinned = [
    project("api", [
      row("a1", "api", "2026-11-01T00:00:00Z"),
      row("a2", "api", "2026-11-03T00:00:00Z"),
    ]),
    project("web", [row("w2", "web", "2026-11-04T00:00:00Z")]),
  ];
  expect(
    shape(sidebarSections(repinned, new Map(), "project", ["a1", "a2"]))[0],
  ).toEqual(["pinned", ["w2", "a1", "a2"]]);
});
