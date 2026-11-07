import type { PaseoProject } from "@getpaseo/client";
import {
  getWorkspaceStateBucketPriority,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";
import {
  applyStoredOrder,
  moveKey,
  type OrderChange,
  type StoredOrder,
} from "../workspace/ordering.js";
import type { ProjectNode, WorkspaceRow } from "../workspace/workspaces.js";

export type SidebarGrouping = "project" | "status";
export type SidebarSection =
  | {
      kind: "pinned";
      key: "pinned";
      title: "Pinned";
      workspaces: readonly WorkspaceRow[];
    }
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

/** The daemon leaves `activityAt` null for idle workspaces, so fall back to when it went idle. */
function lastActivity(row: WorkspaceRow): string | null {
  return row.activityAt ?? row.statusEnteredAt ?? row.lastUserMessageAt ?? null;
}
function byLatestActivity(a: WorkspaceRow, b: WorkspaceRow): number {
  const left = lastActivity(a);
  const right = lastActivity(b);
  let activityOrder = 0;
  if (left === null && right !== null) activityOrder = 1;
  else if (left !== null && right === null) activityOrder = -1;
  else if (left !== null && right !== null)
    activityOrder = Date.parse(right) - Date.parse(left);
  return (
    activityOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}

function isPinned(row: WorkspaceRow): boolean {
  return row.pinnedAt != null;
}
/** Pinned workspaces, newest pin first, then in the stored pinned order. */
function pinnedRows(
  projects: readonly ProjectNode[],
  stored: readonly string[],
): WorkspaceRow[] {
  const pinned = projects
    .flatMap((node) => node.workspaces)
    .filter(isPinned)
    .toSorted((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  return applyStoredOrder(pinned, stored, (row) => row.id);
}
/** The tree without its pinned workspaces; projects stay even when emptied. */
export function unpinnedProjects(
  projects: readonly ProjectNode[],
): ProjectNode[] {
  return projects.map((node) => ({
    ...node,
    workspaces: node.workspaces.filter((row) => !isPinned(row)),
  }));
}
/** Moves a pinned workspace by `delta` within Pinned; null for unpinned ones or at an edge. */
export function pinnedMove(
  projects: readonly ProjectNode[],
  order: StoredOrder,
  workspaceId: string,
  delta: number,
): OrderChange | null {
  const keys = moveKey(
    pinnedRows(projects, order.pinned).map((row) => row.id),
    workspaceId,
    delta,
    order.pinned,
  );
  return keys && { kind: "pinned", keys };
}

/** The stored pinned order without an unpinned workspace; null when it was not stored. */
export function unpinnedOrder(
  order: StoredOrder,
  workspaceId: string,
): OrderChange | null {
  if (!order.pinned.includes(workspaceId)) return null;
  return {
    kind: "pinned",
    keys: order.pinned.filter((key) => key !== workspaceId),
  };
}

/** Sidebar sections in display order; their workspaces are also the j/k and jump order. */
export function sidebarSections(
  projects: readonly ProjectNode[],
  buckets: ReadonlyMap<string, WorkspaceStateBucket>,
  grouping: SidebarGrouping,
  pinnedOrder: readonly string[] = [],
): SidebarSection[] {
  const pinned = pinnedRows(projects, pinnedOrder);
  return [
    ...(pinned.length
      ? [
          {
            kind: "pinned" as const,
            key: "pinned" as const,
            title: "Pinned" as const,
            workspaces: pinned,
          },
        ]
      : []),
    ...groupedSections(unpinnedProjects(projects), buckets, grouping),
  ];
}
function groupedSections(
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
    .map((bucket): SidebarSection => {
      const matching = rows.filter(
        (row) => (buckets.get(row.id) ?? "done") === bucket,
      );
      return {
        kind: "status",
        key: `status:${bucket}`,
        bucket,
        title: BUCKET_TITLES[bucket],
        workspaces:
          bucket === "done" ? matching.toSorted(byLatestActivity) : matching,
      };
    })
    .filter((section) => section.workspaces.length > 0);
}
