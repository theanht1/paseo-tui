import type { PaseoProject } from "@getpaseo/client";
import { expect, test } from "vitest";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import {
  filterNote,
  filterProjects,
  pruneFilter,
  toggleFilterKey,
  UNLABELLED,
} from "./label-filter.js";

function row(id: string, labels?: string[]): WorkspaceRow {
  return {
    id,
    projectId: "p",
    projectRootPath: "/p",
    activityAt: null,
    statusEnteredAt: null,
    workspaceDirectory: `/p/${id}`,
    name: id,
    ...(labels ? { labels } : {}),
  };
}
const project = (projectId: string): PaseoProject => ({
  projectId,
  projectDisplayName: projectId,
  projectRootPath: `/${projectId}`,
  projectKind: "git",
});
const tree = [
  {
    project: project("one"),
    workspaces: [
      row("bug", ["Bug"]),
      row("both", ["bug", "UI"]),
      row("plain"),
      row("blank", ["  "]),
    ],
  },
  { project: project("two"), workspaces: [row("ui", ["ui"])] },
];
const ids = (projects: ReturnType<typeof filterProjects>) =>
  projects.map((node) => [
    node.project.projectId,
    node.workspaces.map((w) => w.id),
  ]);

test("shows workspaces carrying any selected label, Unlabelled included", () => {
  expect(filterProjects(tree, [])).toBe(tree);
  expect(ids(filterProjects(tree, ["bug"]))).toEqual([
    ["one", ["bug", "both"]],
  ]);
  expect(ids(filterProjects(tree, ["ui", UNLABELLED]))).toEqual([
    ["one", ["both", "plain", "blank"]],
    ["two", ["ui"]],
  ]);
});

test("toggles keys by label identity", () => {
  expect(toggleFilterKey([], "Bug")).toEqual(["bug"]);
  expect(toggleFilterKey(["bug", ""], "BUG")).toEqual([""]);
});

test("drops keys the catalog no longer has, only when it is authoritative", () => {
  const keys = ["bug", "gone", UNLABELLED];
  const labels = [{ name: "Bug", color: "red" as const }];
  expect(pruneFilter(keys, labels, false)).toBe(keys);
  expect(pruneFilter(keys, labels, true)).toEqual(["bug", UNLABELLED]);
  const kept = ["bug"];
  expect(pruneFilter(kept, labels, true)).toBe(kept);
});

test("names the active filter for the status bar", () => {
  const labels = [{ name: "Bug", color: "red" as const }];
  expect(filterNote([], labels)).toBeNull();
  expect(filterNote(["bug", UNLABELLED, "gone"], labels)).toBe(
    "filter: Bug, Unlabelled, gone",
  );
});
