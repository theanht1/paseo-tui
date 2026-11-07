import {
  type WorkspaceLabelDefinition,
  workspaceLabelKey,
} from "@getpaseo/protocol/workspace-labels";
import type { ProjectNode } from "../workspace/workspaces.js";

/** The filter key for workspaces with no label; real label names never normalize to it. */
export const UNLABELLED = "";

/** Workspaces carrying any of the selected labels (OR); projects left empty are hidden. */
export function filterProjects(
  projects: readonly ProjectNode[],
  keys: readonly string[],
): readonly ProjectNode[] {
  if (keys.length === 0) return projects;
  const wanted = new Set(keys);
  return projects.flatMap((node) => {
    const workspaces = node.workspaces.filter((workspace) => {
      const carried = (workspace.labels ?? [])
        .map(workspaceLabelKey)
        .filter(Boolean);
      return carried.length === 0
        ? wanted.has(UNLABELLED)
        : carried.some((key) => wanted.has(key));
    });
    return workspaces.length ? [{ ...node, workspaces }] : [];
  });
}

export function toggleFilterKey(
  keys: readonly string[],
  name: string,
): string[] {
  const key = workspaceLabelKey(name);
  return keys.includes(key)
    ? keys.filter((other) => other !== key)
    : [...keys, key];
}

/** Keys of labels gone from every catalog; only a fully listed catalog can say so. */
export function pruneFilter(
  keys: readonly string[],
  labels: readonly WorkspaceLabelDefinition[],
  authoritative: boolean,
): readonly string[] {
  if (!authoritative) return keys;
  const known = new Set(labels.map((label) => workspaceLabelKey(label.name)));
  const kept = keys.filter((key) => key === UNLABELLED || known.has(key));
  return kept.length === keys.length ? keys : kept;
}

export function filterNote(
  keys: readonly string[],
  labels: readonly WorkspaceLabelDefinition[],
): string | null {
  if (keys.length === 0) return null;
  const names = new Map(
    labels.map((label) => [workspaceLabelKey(label.name), label.name]),
  );
  return `filter: ${keys
    .map((key) => (key === UNLABELLED ? "Unlabelled" : (names.get(key) ?? key)))
    .join(", ")}`;
}
