import type { RenameTarget } from "../management-controller.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";

export interface MenuItem {
  id: string;
  title: string;
  shortcut: string;
  tone: "normal" | "danger";
  run(): void;
}
export interface MenuActions {
  rename(): void;
  archive(workspace: WorkspaceRow): void;
  labels(workspace: WorkspaceRow): void;
  /** The workspace's host has `workspacePinning`. */
  canPin(workspace: WorkspaceRow): boolean;
  setPinned(workspace: WorkspaceRow, pinned: boolean): void;
}

/** The context menu's rows for a right-clicked target, in display order. */
export function menuItems(
  target: RenameTarget,
  actions: MenuActions,
): MenuItem[] {
  const rename: MenuItem = {
    id: "rename",
    title: "Rename",
    shortcut: "r",
    tone: "normal",
    run: actions.rename,
  };
  if (target.kind === "tab") return [rename];
  const { workspace } = target;
  const pinned = workspace.pinnedAt != null;
  return [
    rename,
    ...(actions.canPin(workspace)
      ? [
          {
            id: "pin",
            title: pinned ? "Unpin" : "Pin",
            shortcut: "p",
            tone: "normal" as const,
            run: () => actions.setPinned(workspace, !pinned),
          },
        ]
      : []),
    {
      id: "labels",
      title: "Labels…",
      shortcut: "l",
      tone: "normal",
      run: () => actions.labels(workspace),
    },
    {
      id: "archive",
      title: "Archive workspace",
      shortcut: "a",
      tone: "danger",
      run: () => actions.archive(workspace),
    },
  ];
}
