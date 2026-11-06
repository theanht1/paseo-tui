import { posix } from "node:path";
import type { CommandItem } from "./registry.js";

export interface PathContext {
  /** The open workspace's directory. */
  workspace: string | null;
  /** The file the focused editor tab was opened with (absolute, or `~/…`). */
  file: string | null;
  copy(text: string): void;
}
function item(
  id: string,
  title: string,
  path: string,
  copy: (text: string) => void,
): CommandItem {
  return {
    id,
    group: "Workspaces",
    title,
    subtitle: path,
    keywords: ["copy", "path", "clipboard", "yank"],
    run(): undefined {
      copy(path);
    },
  };
}
/** Copy the workspace directory, and the open file's path relative to it and in full. */
export function pathCommands({
  workspace,
  file,
  copy,
}: PathContext): CommandItem[] {
  const items: CommandItem[] = [];
  if (workspace)
    items.push(
      item("copy-workspace-path", "Copy workspace path", workspace, copy),
    );
  if (!file) return items;
  const relative = workspace ? posix.relative(workspace, file) : "";
  if (relative && !relative.startsWith("..") && !posix.isAbsolute(relative))
    items.push(
      item("copy-file-relative", "Copy file path (relative)", relative, copy),
    );
  items.push(
    item("copy-file-absolute", "Copy file path (absolute)", file, copy),
  );
  return items;
}
