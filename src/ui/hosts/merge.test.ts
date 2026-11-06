import type { PaseoProject } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { mergeHosts } from "./merge.js";

function project(
  projectId: string,
  name: string,
  projectKey?: string,
  extra: Partial<PaseoProject> = {},
): PaseoProject {
  return {
    projectId,
    projectDisplayName: name,
    projectRootPath: `/src/${name}`,
    projectKind: "git",
    ...(projectKey ? { projectKey } : {}),
    ...extra,
  };
}
function workspace(id: string, projectId: string): WorkspaceRow {
  return {
    id,
    projectId,
    projectRootPath: "/src",
    workspaceDirectory: "/src",
    name: id,
  };
}

it("merges one repository across hosts by its project key, like the desktop app", () => {
  const merged = mergeHosts([
    {
      hostId: "local",
      label: "local",
      projects: [project("p1", "app", "github.com/me/app")],
      workspaces: [workspace("w1", "p1")],
    },
    {
      hostId: "build",
      label: "build",
      projects: [
        project("p9", "app", "github.com/me/app"),
        project("p2", "tools"),
      ],
      workspaces: [workspace("w2", "p9"), workspace("w3", "p2")],
    },
  ]);
  expect(
    merged.projects.map((p) => [p.projectId, p.projectDisplayName]),
  ).toEqual([
    ["github.com/me/app", "app"],
    ['["build","p2"]', "tools"],
  ]);
  expect(merged.workspaces.map((row) => [row.id, row.projectId])).toEqual([
    ["w1", "github.com/me/app"],
    ["w2", "github.com/me/app"],
    ["w3", '["build","p2"]'],
  ]);
  expect(merged.placements.get("github.com/me/app")).toEqual([
    { hostId: "local", project: expect.objectContaining({ projectId: "p1" }) },
    { hostId: "build", project: expect.objectContaining({ projectId: "p9" }) },
  ]);
  expect([...merged.workspaceHosts]).toEqual([
    ["w1", "local"],
    ["w2", "build"],
    ["w3", "build"],
  ]);
});

it("keeps projects apart when a host has two with the same key, or none", () => {
  const merged = mergeHosts([
    {
      hostId: "local",
      label: "local",
      projects: [
        project("a", "dup", "key"),
        project("b", "dup-copy", "key"),
        project("c", "plain"),
      ],
      workspaces: [],
    },
    {
      hostId: "build",
      label: "build",
      projects: [project("c", "plain")],
      workspaces: [],
    },
  ]);
  expect(merged.projects.map((p) => p.projectId)).toEqual([
    '["local","a"]',
    '["local","b"]',
    '["build","c"]',
    '["local","c"]',
  ]);
});

it("names a merged project after a custom name from any host", () => {
  const merged = mergeHosts([
    {
      hostId: "local",
      label: "local",
      projects: [project("p1", "app", "k")],
      workspaces: [],
    },
    {
      hostId: "build",
      label: "build",
      projects: [project("p2", "app", "k", { projectCustomName: "App!" })],
      workspaces: [],
    },
  ]);
  expect(merged.projects[0]?.projectCustomName).toBe("App!");
});
