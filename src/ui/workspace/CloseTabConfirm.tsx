import { agentName } from "../agent/agent-display.js";
import { ConfirmDialog } from "../overlays/ConfirmDialog.js";
import { tabName, type WorkspaceTab } from "./workspaces.js";

export function CloseTabConfirm({
  tab,
  onConfirm,
  onCancel,
}: {
  tab: WorkspaceTab;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <ConfirmDialog
      id="close-tab"
      title="Close tab?"
      message={
        tab.kind === "agent"
          ? `Archive agent “${agentName(tab.agent)}”?`
          : tab.kind === "terminal"
            ? `Kill terminal “${tab.terminal.name}” and its running process?`
            : `Close subagent tab “${tabName(tab)}”?`
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
