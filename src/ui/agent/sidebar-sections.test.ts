import { expect, it } from "vitest";
import type { ProjectNode, WorkspaceRow } from "../workspace/workspaces.js";
import { sidebarSections } from "./sidebar-sections.js";

function row(id: string, projectId: string): WorkspaceRow {
  return {
    id,
    activityAt: null,
    statusEnteredAt: null,
    projectId,
    name: id,
    projectRootPath: `/${projectId}`,
    workspaceDirectory: `/${projectId}`,
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
const projects = [
  project("api", [row("a1", "api"), row("a2", "api")]),
  project("web", [row("w1", "web"), row("w2", "web")]),
];

it("keeps the project tree when grouping by project", () => {
  const sections = sidebarSections(projects, new Map(), "project");
  expect(
    sections.map((section) => [
      section.key,
      section.workspaces.map((workspace) => workspace.id),
    ]),
  ).toEqual([
    ["project:api", ["a1", "a2"]],
    ["project:web", ["w1", "w2"]],
  ]);
});

it("groups by status act-first, keeps project order inside a group, and drops empty groups", () => {
  const sections = sidebarSections(
    projects,
    new Map([
      ["a1", "running"],
      ["a2", "needs_input"],
      ["w1", "attention"],
      ["w2", "needs_input"],
    ]),
    "status",
  );
  expect(
    sections.map((section) => [
      section.kind === "status" ? section.title : "",
      section.workspaces.map((workspace) => workspace.id),
    ]),
  ).toEqual([
    ["Needs input", ["a2", "w2"]],
    ["Running", ["a1"]],
    ["Unread", ["w1"]],
  ]);
});

it("orders Idle workspaces by latest activity, then name and id", () => {
  const idle = [
    { ...row("null-z", "api"), name: "Z", activityAt: null },
    {
      ...row("tie-b", "api"),
      name: "Same",
      activityAt: "2026-11-02T00:00:00Z",
      statusEnteredAt: null,
    },
    { ...row("old", "api"), name: "Old", activityAt: "2026-11-01T00:00:00Z" },
    {
      ...row("tie-a", "api"),
      name: "Same",
      activityAt: "2026-11-02T00:00:00Z",
      statusEnteredAt: null,
    },
    { ...row("new", "api"), name: "New", activityAt: "2026-11-03T00:00:00Z" },
    { ...row("null-a", "api"), name: "A", activityAt: null },
  ];
  const sections = sidebarSections([project("api", idle)], new Map(), "status");
  expect(sections[0]?.workspaces.map((workspace) => workspace.id)).toEqual([
    "new",
    "tie-a",
    "tie-b",
    "old",
    "null-a",
    "null-z",
  ]);
});

it("orders Idle by when it went idle when the daemon reports no activity time", () => {
  const idle = [
    {
      ...row("older", "api"),
      name: "A",
      statusEnteredAt: "2026-11-01T00:00:00Z",
    },
    {
      ...row("prompted", "api"),
      name: "B",
      statusEnteredAt: null,
      lastUserMessageAt: "2026-11-02T00:00:00Z",
    },
    {
      ...row("newest", "api"),
      name: "C",
      statusEnteredAt: "2026-11-03T00:00:00Z",
    },
  ];
  const sections = sidebarSections([project("api", idle)], new Map(), "status");
  expect(sections[0]?.workspaces.map((workspace) => workspace.id)).toEqual([
    "newest",
    "prompted",
    "older",
  ]);
});
