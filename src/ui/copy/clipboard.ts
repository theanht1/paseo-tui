import { spawn } from "node:child_process";

/** OpenTUI's renderer encodes OSC 52 (and tmux passthrough) natively. */
export interface ClipboardWriter {
  copyToClipboardOSC52(text: string): boolean;
}
/** The local system clipboard of the machine running the TUI. */
export interface SystemClipboard {
  write(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
}
export interface ClipboardCommand {
  command: string;
  args: string[];
}
export type RunResult =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "failed"; message: string };
export interface ClipboardRunner {
  run(command: ClipboardCommand, input: string): Promise<RunResult>;
}

/** Native clipboard tools in the order to try them. */
export function clipboardCommands(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): ClipboardCommand[] {
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  if (platform === "win32") return [{ command: "clip.exe", args: [] }];
  return [
    ...(env.WAYLAND_DISPLAY ? [{ command: "wl-copy", args: [] }] : []),
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

function missingMessage(platform: NodeJS.Platform) {
  if (platform === "darwin")
    return "no clipboard tool found: pbcopy is missing";
  if (platform === "win32")
    return "no clipboard tool found: clip.exe is missing";
  return "no clipboard tool found: install xclip, xsel or wl-clipboard";
}

export function systemClipboard(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  runner: ClipboardRunner,
): SystemClipboard {
  return {
    async write(text) {
      let failure: string | null = null;
      for (const command of clipboardCommands(platform, env)) {
        const result = await runner.run(command, text);
        if (result.kind === "ok") return { ok: true };
        if (result.kind === "failed") failure = result.message;
      }
      return { ok: false, error: failure ?? missingMessage(platform) };
    },
  };
}

/** Spawns the tool without a shell and writes the text to its stdin. */
export const nodeClipboardRunner: ClipboardRunner = {
  run(command, input) {
    return new Promise((resolve) => {
      const child = spawn(command.command, command.args, {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", (error: NodeJS.ErrnoException) =>
        resolve(
          error.code === "ENOENT"
            ? { kind: "missing" }
            : {
                kind: "failed",
                message: `${command.command}: ${error.message}`,
              },
        ),
      );
      // xclip and wl-copy fork a selection owner that keeps stderr open, so wait for exit only.
      child.once("exit", (code) =>
        resolve(
          code === 0
            ? { kind: "ok" }
            : {
                kind: "failed",
                message: `${command.command} exited with ${code ?? "a signal"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
              },
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  },
};

/** Copies to the local clipboard and via OSC 52 (for SSH); succeeds when either works. */
export async function copyText(
  writer: ClipboardWriter,
  system: SystemClipboard | null,
  text: string,
): Promise<string | null> {
  if (!text) return null;
  const chars = Array.from(text).length;
  const osc = writer.copyToClipboardOSC52(text);
  const native = system ? await system.write(text) : null;
  if (osc || native?.ok) return `Copied ${chars} char${chars === 1 ? "" : "s"}`;
  return `Clipboard unavailable: ${native && !native.ok ? native.error : "terminal does not support OSC 52"}`;
}
