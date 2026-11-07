import type { WorkspaceRow } from "../workspace/workspaces.js";
import type { CommandItem } from "./registry.js";

export const PINS_UNSUPPORTED =
  "Update the Paseo daemon to pin workspaces (workspacePinning)";

/** What the window can ask of the daemon about pinned workspaces. */
export interface WorkspacePinActions {
  canPin(workspaceId: string): boolean;
  setPinned(workspaceId: string, pinned: boolean): Promise<void>;
}
export interface PinContext {
  /** The workspace under the sidebar cursor. */
  workspace: WorkspaceRow | null;
  canPin(workspaceId: string): boolean;
  toggle(workspace: WorkspaceRow): void;
}
/** Pin workspace / Unpin workspace for the selected workspace. */
export function pinCommands({
  workspace,
  canPin,
  toggle,
}: PinContext): CommandItem[] {
  if (!workspace) return [];
  const title =
    workspace.pinnedAt != null ? "Unpin workspace" : "Pin workspace";
  if (!canPin(workspace.id))
    return [
      {
        id: "pin-workspace",
        group: "Workspaces",
        title,
        subtitle: PINS_UNSUPPORTED,
        keywords: ["pin", "top"],
        run: () => ({
          kind: "readOnly",
          title,
          lines: () => [PINS_UNSUPPORTED],
        }),
      },
    ];
  return [
    {
      id: "pin-workspace",
      group: "Workspaces",
      title,
      subtitle: workspace.title || workspace.name,
      keywords: ["pin", "unpin", "top", "favorite"],
      action: { type: "workspace.togglePin" },
      run(): undefined {
        toggle(workspace);
      },
    },
  ];
}
