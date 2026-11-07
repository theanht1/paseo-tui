import type { CompletionPort } from "../../connection/ports.js";
import { CommandCenter } from "../command-center/CommandCenter.js";
import type { CommandRegistry } from "../command-center/registry.js";
import type {
  createManagementController,
  ManagementOverlay,
} from "../management-controller.js";
import { CloseTabConfirm } from "../workspace/CloseTabConfirm.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ContextMenu } from "./ContextMenu.js";
import { menuItems } from "./context-menu-items.js";

type ManagementController = ReturnType<typeof createManagementController>;
/** The dialog, menu, or wizard the management controller has open. */
export function ManagementOverlayView({
  overlay,
  manager,
  registry,
  completions,
  onLabels,
  canPin,
  onPin,
}: {
  overlay: ManagementOverlay;
  manager: ManagementController;
  registry: CommandRegistry;
  completions?: CompletionPort;
  onLabels(workspace: WorkspaceRow): void;
  canPin(workspace: WorkspaceRow): boolean;
  onPin(workspace: WorkspaceRow, pinned: boolean): void;
}) {
  switch (overlay.kind) {
    case "closed":
      return null;
    case "confirm-close":
      return (
        <CloseTabConfirm
          tab={overlay.tab}
          onConfirm={manager.confirmCloseTab}
          onCancel={manager.close}
        />
      );
    case "confirm-archive":
      return (
        <ConfirmDialog
          id="archive-workspace"
          title="Archive workspace?"
          message={`Archive workspace “${overlay.workspace.title || overlay.workspace.name}”? Its tabs close.`}
          onConfirm={manager.confirmArchiveWorkspace}
          onCancel={manager.close}
        />
      );
    case "menu": {
      return (
        <ContextMenu
          x={overlay.x}
          y={overlay.y}
          items={menuItems(overlay.target, {
            rename: manager.renameMenu,
            archive: manager.archiveWorkspace,
            labels: onLabels,
            canPin,
            setPinned: onPin,
          })}
          onClose={manager.close}
        />
      );
    }
    case "wizard":
      return (
        <CommandCenter
          key={overlay.title}
          registry={registry}
          title={overlay.title}
          initialStep={overlay.step}
          completions={completions}
          onClose={manager.close}
        />
      );
  }
}
