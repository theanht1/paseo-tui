import type { WorkspaceStateBucket } from "@getpaseo/protocol/agent-state-bucket";

export interface BucketHold {
  workspaceId: string;
  released: boolean;
}

type Buckets = ReadonlyMap<string, WorkspaceStateBucket>;

/** Keeps the active workspace in Unread after it is opened, until focus leaves it. */
export function advanceHold(
  previous: BucketHold | null,
  activeWorkspaceId: string | null,
  buckets: Buckets,
): BucketHold | null {
  if (activeWorkspaceId === null) return null;
  const bucket = buckets.get(activeWorkspaceId);
  if (previous?.workspaceId !== activeWorkspaceId)
    return {
      workspaceId: activeWorkspaceId,
      released: bucket !== "attention",
    };
  if (previous.released || bucket === "done" || bucket === "attention")
    return previous;
  return { ...previous, released: true };
}

export function releaseHold(
  hold: BucketHold | null,
  workspaceIds: readonly string[],
): BucketHold | null {
  if (!hold || hold.released || !workspaceIds.includes(hold.workspaceId))
    return hold;
  return { ...hold, released: true };
}

export function displayedBuckets(
  hold: BucketHold | null,
  buckets: Buckets,
): Buckets {
  if (!hold || hold.released || buckets.get(hold.workspaceId) !== "done")
    return buckets;
  return new Map(buckets).set(hold.workspaceId, "attention");
}
