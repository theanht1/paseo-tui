import type { PaseoProject } from "@getpaseo/client";
import type { WorkspaceRow } from "../workspace/workspaces.js";

export interface HostDirectory {
  hostId: string;
  label: string;
  projects: readonly PaseoProject[];
  workspaces: readonly WorkspaceRow[];
}
/** Where a merged project lives on one host: that host's own project. */
export interface ProjectPlacement {
  hostId: string;
  project: PaseoProject;
}
export interface MergedHosts {
  /** One per merged project; `projectId` is the merged view key. */
  projects: PaseoProject[];
  /** Every host's workspaces, `projectId` rewritten to the merged view key. */
  workspaces: WorkspaceRow[];
  placements: ReadonlyMap<string, readonly ProjectPlacement[]>;
  workspaceHosts: ReadonlyMap<string, string>;
}
function name(project: PaseoProject) {
  return project.projectCustomName || project.projectDisplayName;
}
/**
 * All hosts' projects and workspaces as one list, the desktop app's way: projects share
 * a row when hosts report the same `projectKey` (the repository) and each host has
 * just one project with it; others stay one row per host. Sorted by name.
 */
export function mergeHosts(hosts: readonly HostDirectory[]): MergedHosts {
  const counts = new Map<string, Map<string, number>>();
  for (const host of hosts) {
    const perHost = new Map<string, number>();
    for (const project of host.projects)
      if (project.projectKey)
        perHost.set(
          project.projectKey,
          (perHost.get(project.projectKey) ?? 0) + 1,
        );
    counts.set(host.hostId, perHost);
  }
  const views = new Map<
    string,
    { project: PaseoProject; placements: ProjectPlacement[] }
  >();
  const viewOf = new Map<string, string>();
  for (const host of hosts)
    for (const project of host.projects) {
      const key = project.projectKey;
      const viewKey =
        key && counts.get(host.hostId)?.get(key) === 1
          ? key
          : JSON.stringify([host.hostId, project.projectId]);
      viewOf.set(JSON.stringify([host.hostId, project.projectId]), viewKey);
      const placement = { hostId: host.hostId, project };
      const view = views.get(viewKey);
      if (!view)
        views.set(viewKey, {
          project: { ...project, projectId: viewKey },
          placements: [placement],
        });
      else {
        view.placements.push(placement);
        if (project.projectCustomName && !view.project.projectCustomName)
          view.project = {
            ...view.project,
            projectCustomName: project.projectCustomName,
          };
      }
    }
  const workspaceHosts = new Map<string, string>();
  const workspaces = hosts.flatMap((host) =>
    host.workspaces.map((workspace): WorkspaceRow => {
      workspaceHosts.set(workspace.id, host.hostId);
      const viewKey = viewOf.get(
        JSON.stringify([host.hostId, workspace.projectId]),
      );
      return viewKey ? { ...workspace, projectId: viewKey } : workspace;
    }),
  );
  const projects = [...views.entries()]
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        name(left.project).localeCompare(name(right.project), undefined, {
          numeric: true,
          sensitivity: "base",
        }) || leftKey.localeCompare(rightKey),
    )
    .map(([, view]) => view.project);
  return {
    projects,
    workspaces,
    placements: new Map(
      [...views.entries()].map(([key, view]) => [key, view.placements]),
    ),
    workspaceHosts,
  };
}
