import { spawn } from "node:child_process";
import type { RunResult } from "../copy/clipboard.js";

export interface BrowserCommand {
  command: string;
  args: string[];
}
export interface BrowserRunner {
  run(command: BrowserCommand): Promise<RunResult>;
}
/** The default browser of the machine running the TUI. */
export interface Browser {
  /** Resolves to an error message, or null once the opener started. */
  open(url: string): Promise<string | null>;
}

/**
 * The OS opener for a URL. Windows uses rundll32 rather than `cmd /c start`, because
 * cmd would read `&` in a query string as a command separator.
 */
export function browserCommand(
  platform: NodeJS.Platform,
  url: string,
): BrowserCommand {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32")
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  return { command: "xdg-open", args: [url] };
}

function missingMessage(platform: NodeJS.Platform) {
  if (platform === "darwin") return "no browser opener found: open is missing";
  if (platform === "win32")
    return "no browser opener found: rundll32 is missing";
  return "no browser opener found: install xdg-utils";
}

export function systemBrowser(
  platform: NodeJS.Platform,
  runner: BrowserRunner,
): Browser {
  return {
    async open(url) {
      const result = await runner.run(browserCommand(platform, url));
      if (result.kind === "ok") return null;
      return result.kind === "missing"
        ? missingMessage(platform)
        : result.message;
    },
  };
}

interface SpawnedOpener {
  once(event: "spawn", listener: () => void): unknown;
  once(
    event: "error",
    listener: (error: NodeJS.ErrnoException) => void,
  ): unknown;
  unref(): void;
}
type SpawnOpener = (
  command: string,
  args: readonly string[],
  options: { stdio: "ignore"; detached: true; shell: false },
) => SpawnedOpener;

/** Starts the opener detached and without a shell, so a URL is only ever an argument. */
export function spawnBrowserRunner(start: SpawnOpener): BrowserRunner {
  return {
    run(command) {
      return new Promise((resolve) => {
        const child = start(command.command, command.args, {
          stdio: "ignore",
          detached: true,
          shell: false,
        });
        child.once("error", (error) =>
          resolve(
            error.code === "ENOENT"
              ? { kind: "missing" }
              : {
                  kind: "failed",
                  message: `${command.command}: ${error.message}`,
                },
          ),
        );
        child.once("spawn", () => {
          child.unref();
          resolve({ kind: "ok" });
        });
      });
    },
  };
}

export const nodeBrowserRunner = spawnBrowserRunner(spawn);
