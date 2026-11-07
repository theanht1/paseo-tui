import { posix } from "node:path";
import type { FileLink } from "./links.js";

export interface EditorTerminal {
  name: string;
  command: string;
  args: string[];
}

/** The `fileEditor` setting's default. */
export const DEFAULT_FILE_EDITOR = "vim";
const VIM_FAMILY = new Set(["vi", "vim", "nvim", "view", "gvim", "mvim"]);

function quote(text: string) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Vim gets the line and column and `--`; other editors only the common `+<line>`. */
function positionArgs(
  program: string,
  link: Pick<FileLink, "line" | "col">,
): { position: string[]; separator: string[] } {
  if (!VIM_FAMILY.has(posix.basename(program)))
    return {
      position: link.line === null ? [] : [`+${link.line}`],
      separator: [],
    };
  const position =
    link.line === null
      ? []
      : link.col === null
        ? [`+${link.line}`]
        : [`+call cursor(${link.line},${link.col})`];
  return { position, separator: ["--"] };
}

/**
 * The daemon host's $VISUAL/$EDITOR is unknown, so this runs `command` (the
 * `fileEditor` setting) as the terminal's process: when the editor exits the PTY
 * exits and the daemon drops the terminal. A command with arguments, or a `~/`
 * path, goes through `sh -c`.
 */
export function editorTerminal(
  link: Pick<FileLink, "path" | "line" | "col">,
  command = DEFAULT_FILE_EDITOR,
): EditorTerminal {
  const words = command.trim().split(/\s+/);
  const program = words[0] ?? DEFAULT_FILE_EDITOR;
  const { position, separator } = positionArgs(program, link);
  const name = posix.basename(link.path);
  const home = link.path.startsWith("~/");
  if (words.length === 1 && !home)
    return {
      name,
      command: program,
      args: [...position, ...separator, link.path],
    };
  const path = home ? `~/${quote(link.path.slice(2))}` : quote(link.path);
  const script = [
    "exec",
    command.trim(),
    ...position.map(quote),
    ...separator,
    path,
  ];
  return { name, command: "sh", args: ["-c", script.join(" ")] };
}
