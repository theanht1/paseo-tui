import { posix } from "node:path";
import type { FileLink } from "./links.js";

export interface EditorTerminal {
  name: string;
  command: string;
  args: string[];
}

function quote(text: string) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The daemon host's $VISUAL/$EDITOR is unknown, so this runs vim as the terminal's
 * process: when vim exits the PTY exits and the daemon drops the terminal.
 */
export function editorTerminal(
  link: Pick<FileLink, "path" | "line" | "col">,
): EditorTerminal {
  const position =
    link.line === null
      ? []
      : link.col === null
        ? [`+${link.line}`]
        : [`+call cursor(${link.line},${link.col})`];
  const name = posix.basename(link.path);
  if (!link.path.startsWith("~/"))
    return { name, command: "vim", args: [...position, "--", link.path] };
  const script = [
    "exec vim",
    ...position.map(quote),
    "--",
    `~/${quote(link.path.slice(2))}`,
  ];
  return { name, command: "sh", args: ["-c", script.join(" ")] };
}
