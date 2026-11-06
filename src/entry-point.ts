import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whether the module at `moduleUrl` is the script node was started with.
 * Compares real paths: npm runs a bin through a symlink, while Node resolves
 * symlinks for `import.meta.url`.
 */
export function isEntryPoint(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
