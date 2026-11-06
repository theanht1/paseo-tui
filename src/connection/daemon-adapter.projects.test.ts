import type { PaseoProject } from "@getpaseo/client";
import { expect, test } from "vitest";
import { createProjectAdapter, type ProjectDaemon } from "./daemon-adapter.js";

const project: PaseoProject = {
  projectId: "p",
  projectDisplayName: "app",
  projectRootPath: "/src/app",
  projectKind: "git",
};
class FakeDaemon implements ProjectDaemon {
  calls: unknown[] = [];
  addResult: Awaited<ReturnType<ProjectDaemon["addProject"]>> = {
    project,
    error: null,
  };
  constructor(
    private features: { projectAdd?: boolean; projectRemove?: boolean },
  ) {}
  getLastServerInfoMessage() {
    return { features: this.features };
  }
  async addProject(cwd: string) {
    this.calls.push(["add", cwd]);
    return this.addResult;
  }
  async removeProject(projectId: string) {
    this.calls.push(["remove", projectId]);
    return { removedWorkspaceIds: [] };
  }
  async getDirectorySuggestions(options: {
    query: string;
    includeFiles?: boolean;
    includeDirectories?: boolean;
    limit?: number;
  }) {
    this.calls.push(["suggest", options]);
    return {
      directories: [],
      entries: [
        { path: "/src/app", kind: "directory" as const },
        { path: "/src/app/README.md", kind: "file" as const },
      ],
      error: null,
    };
  }
}

test("adds and removes projects only when the daemon advertises it", async () => {
  const daemon = new FakeDaemon({ projectAdd: true, projectRemove: true });
  const port = createProjectAdapter(daemon);
  expect(await port.add?.("/src/app")).toEqual(project);
  await port.remove?.("p");
  expect(daemon.calls).toEqual([
    ["add", "/src/app"],
    ["remove", "p"],
  ]);
  const old = createProjectAdapter(new FakeDaemon({}));
  expect(old.add).toBeNull();
  expect(old.remove).toBeNull();
});

test("reports why a directory could not be added", async () => {
  const daemon = new FakeDaemon({ projectAdd: true });
  const port = createProjectAdapter(daemon);
  daemon.addResult = {
    project: null,
    error: "nope",
    errorCode: "directory_not_found",
  };
  await expect(port.add?.("/gone")).rejects.toThrow(
    "Directory not found: /gone",
  );
  daemon.addResult = { project: null, error: "Permission denied" };
  await expect(port.add?.("/root")).rejects.toThrow("Permission denied");
});

test("searches the host's directories, without files", async () => {
  const daemon = new FakeDaemon({});
  const port = createProjectAdapter(daemon);
  expect(await port.directories("app")).toEqual(["/src/app"]);
  expect(daemon.calls).toEqual([
    [
      "suggest",
      {
        query: "app",
        includeDirectories: true,
        includeFiles: false,
        limit: 30,
      },
    ],
  ]);
});
