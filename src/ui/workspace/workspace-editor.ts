import type { PaseoTerminal } from "@getpaseo/client";
import type { EditorTerminal } from "../file-links/editor-terminal.js";
import { toolName } from "./diff-tool.js";
import type { WorkspaceTab } from "./workspaces.js";

export const DEFAULT_EDITOR = "nvim";

/**
 * Runs the editor through sh in the workspace directory (the terminal default) on `.`,
 * so the workspace path is never interpolated into the shell.
 */
export function workspaceEditorTerminal(command: string): EditorTerminal {
  return {
    name: toolName(command),
    command: "sh",
    args: ["-c", `${command} .`],
  };
}

/** The workspace's already-open editor tab, recognised by its terminal name. */
export function editorTab(
  workspaceId: string,
  terminals: readonly PaseoTerminal[],
  command: string,
): WorkspaceTab | null {
  const name = toolName(command);
  const terminal = terminals.find(
    (terminal) =>
      terminal.workspaceId === workspaceId && terminal.name === name,
  );
  return terminal
    ? { kind: "terminal", key: `terminal:${terminal.id}`, terminal }
    : null;
}
