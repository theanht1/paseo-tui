import type { WorkspaceStateBucket } from "@getpaseo/protocol/agent-state-bucket";

export type ReadAction =
  | { kind: "read"; title: "Mark as read" }
  | { kind: "unread"; title: "Mark as unread" };

/** The toggle a workspace offers from its status; none while it runs or waits on you. */
export function readAction(
  bucket: WorkspaceStateBucket,
  canMarkUnread: boolean,
): ReadAction | null {
  switch (bucket) {
    case "attention":
    case "failed":
      return { kind: "read", title: "Mark as read" };
    case "done":
      return canMarkUnread ? { kind: "unread", title: "Mark as unread" } : null;
    case "needs_input":
    case "running":
      return null;
  }
}

export function unreadWorkspaceIds(
  buckets: ReadonlyMap<string, WorkspaceStateBucket>,
): string[] {
  return [...buckets]
    .filter(([, bucket]) => readAction(bucket, false)?.kind === "read")
    .map(([id]) => id);
}

/** What the window can ask of the daemon about workspaces' read state. */
export interface WorkspaceReadActions {
  canMarkUnread(workspaceId: string): boolean;
  markRead(workspaceIds: readonly string[]): Promise<void>;
  markUnread(workspaceId: string): Promise<void>;
}
