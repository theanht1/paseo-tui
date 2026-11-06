import { posix } from "node:path";
import type { PaseoTerminal } from "@getpaseo/client";
import type { EditorTerminal } from "../file-links/editor-terminal.js";
import type { WorkspaceTab } from "./workspaces.js";

export const DEFAULT_DIFF_TOOL = "lazygit";

/** `--diff-tool` wins over `PASEO_TUI_DIFF_TOOL`; both fall back to lazygit. */
export function resolveDiffTool(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  if (flag !== undefined) {
    const command = flag.trim();
    if (!command) throw new Error("--diff-tool needs a command");
    return command;
  }
  return env.PASEO_TUI_DIFF_TOOL?.trim() || DEFAULT_DIFF_TOOL;
}

export function toolName(command: string): string {
  return posix.basename(command.trim().split(/\s+/)[0] ?? command);
}

/**
 * Runs the command through sh in the workspace directory (the terminal default), so it
 * may carry arguments; when the tool exits the PTY exits and the daemon drops the tab.
 */
export function diffToolTerminal(command: string): EditorTerminal {
  return { name: toolName(command), command: "sh", args: ["-c", command] };
}

/** The workspace's already-open tab for this tool, recognised by its terminal name. */
export function diffToolTab(
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
