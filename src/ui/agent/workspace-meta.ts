import type { WorkspaceRow } from "../workspace/workspaces.js";

const CHECKS = { success: "✓", failure: "✗", pending: "…", none: "" } as const;
/** One dim line of git facts under a sidebar row: branch, diff size, PR and its checks. */
export function workspaceMeta(row: WorkspaceRow): string | null {
  const parts: string[] = [];
  const branch = row.gitRuntime?.currentBranch;
  const ahead = row.gitRuntime?.aheadOfOrigin ?? 0;
  const git = [
    branch && branch !== (row.title || row.name) ? `⎇ ${branch}` : "",
    ahead > 0 ? `↑${ahead}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (git) parts.push(git);
  const diff = row.diffStat;
  if (diff && diff.additions + diff.deletions > 0)
    parts.push(`+${diff.additions} −${diff.deletions}`);
  const pr = row.githubRuntime?.pullRequest;
  if (pr?.number != null) {
    const state = pr.isMerged
      ? "merged"
      : pr.isDraft
        ? "draft"
        : CHECKS[pr.checksStatus ?? "none"];
    parts.push(state ? `#${pr.number} ${state}` : `#${pr.number}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export interface SetupTag {
  text: string;
  tone: "running" | "error" | "attention";
}
/** Worktree setup (`paseo.json`) that still needs a look; completed setup shows nothing. */
export function setupTag(row: WorkspaceRow): SetupTag | null {
  switch (row.setupStatus) {
    case "running":
      return { text: "setup…", tone: "running" };
    case "failed":
      return { text: "setup failed", tone: "error" };
    case "blocked":
      return { text: "setup blocked", tone: "attention" };
    case "completed":
    case null:
    case undefined:
      return null;
  }
}
const HOST_TAG_WIDTH = 10;
/** A workspace's host name, short enough to share the title row in the sidebar. */
export function hostTag(label: string): string {
  const name = label.trim();
  return name.length > HOST_TAG_WIDTH
    ? `${name.slice(0, HOST_TAG_WIDTH - 1)}…`
    : name;
}
