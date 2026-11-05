import type { PaseoProject } from "@getpaseo/client";
import {
  getWorkspaceStateBucketPriority,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";
import type { ProjectNode, WorkspaceRow } from "../workspace/workspaces.js";

export type SidebarGrouping = "project" | "status";
export type SidebarSection =
  | {
      kind: "project";
      key: string;
      project: PaseoProject;
      workspaces: readonly WorkspaceRow[];
    }
  | {
      kind: "status";
      key: string;
      bucket: WorkspaceStateBucket;
      title: string;
      workspaces: readonly WorkspaceRow[];
    };
const BUCKET_TITLES: Record<WorkspaceStateBucket, string> = {
  needs_input: "Needs input",
  failed: "Failed",
  running: "Running",
  attention: "Unread",
  done: "Idle",
};
/** Sidebar sections in display order; their workspaces are also the j/k and jump order. */
export function sidebarSections(
  projects: readonly ProjectNode[],
  buckets: ReadonlyMap<string, WorkspaceStateBucket>,
  grouping: SidebarGrouping,
): SidebarSection[] {
  if (grouping === "project")
    return projects.map(({ project, workspaces }) => ({
      kind: "project",
      key: `project:${project.projectId}`,
      project,
      workspaces,
    }));
  const rows = projects.flatMap((node) => node.workspaces);
  return (Object.keys(BUCKET_TITLES) as WorkspaceStateBucket[])
    .sort(
      (a, b) =>
        getWorkspaceStateBucketPriority(a) - getWorkspaceStateBucketPriority(b),
    )
    .map(
      (bucket): SidebarSection => ({
        kind: "status",
        key: `status:${bucket}`,
        bucket,
        title: BUCKET_TITLES[bucket],
        workspaces: rows.filter(
          (row) => (buckets.get(row.id) ?? "done") === bucket,
        ),
      }),
    )
    .filter((section) => section.workspaces.length > 0);
}
