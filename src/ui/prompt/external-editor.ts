import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface EditorDeps {
  env: NodeJS.ProcessEnv;
  /** The TUI renderer: releases the terminal while the editor owns it. */
  host: { suspend(): Promise<void>; resume(): Promise<void> };
  files: {
    create(text: string): Promise<string>;
    read(path: string): Promise<string | null>;
    remove(path: string): Promise<void>;
  };
  spawn(command: string, path: string): Promise<number>;
}

export function editorCommand(env: NodeJS.ProcessEnv): string {
  return env.VISUAL?.trim() || env.EDITOR?.trim() || "vim";
}

/** Returns the edited text, or the original on a non-zero exit or a missing file. */
export async function editExternally(
  text: string,
  deps: EditorDeps,
): Promise<string> {
  const path = await deps.files.create(text);
  try {
    let code: number;
    await deps.host.suspend();
    try {
      code = await deps.spawn(editorCommand(deps.env), path);
    } finally {
      await deps.host.resume();
    }
    if (code !== 0) return text;
    const edited = await deps.files.read(path);
    return edited === null ? text : edited.replace(/\n+$/, "");
  } finally {
    await deps.files.remove(path);
  }
}

export function nodeEditorFiles(): EditorDeps["files"] {
  return {
    async create(text) {
      const dir = await mkdtemp(join(tmpdir(), "paseo-tui-prompt-"));
      const path = join(dir, "PROMPT.md");
      await writeFile(path, text, "utf8");
      return path;
    },
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
    async remove(path) {
      await rm(dirname(path), { recursive: true, force: true });
    },
  };
}

function quote(path: string) {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}
export function nodeEditorSpawn(command: string, path: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(`${command} ${quote(path)}`, {
      shell: true,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
