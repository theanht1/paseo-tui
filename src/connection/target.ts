import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type HostTarget =
  | { kind: "home"; home: string }
  | { kind: "host"; connection: string };

export interface TargetOptions {
  host?: string;
  home?: string;
}

export function resolveTarget(
  argv: TargetOptions,
  env: NodeJS.ProcessEnv,
): HostTarget {
  for (const key of ["home", "host"] as const) {
    const value = argv[key];
    if (value !== undefined && !value.trim()) {
      throw new Error(`--${key} requires a non-empty value.`);
    }
  }
  if (argv.host !== undefined && argv.home !== undefined) {
    throw new Error("Choose either --home or --host, not both.");
  }
  if (argv.host !== undefined) {
    return { kind: "host", connection: argv.host };
  }
  if (argv.home === undefined && env.PASEO_HOST && env.PASEO_HOME) {
    throw new Error(
      "PASEO_HOME and PASEO_HOST are both set. Choose --home or --host explicitly.",
    );
  }
  if (argv.home === undefined && env.PASEO_HOST) {
    return { kind: "host", connection: env.PASEO_HOST };
  }
  const home = argv.home ?? env.PASEO_HOME ?? "~/.paseo";
  const expanded =
    home === "~" || home.startsWith("~/") ? homedir() + home.slice(1) : home;
  return { kind: "home", home: resolve(expanded) };
}

export function resolveListen(home: string): string {
  const message = `Paseo daemon is not running for ${home} (no paseo.pid). Start Paseo, or pass --host.`;
  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(join(home, "paseo.pid"), "utf8"));
  } catch {
    throw new Error(message);
  }
  if (
    typeof lock !== "object" ||
    lock === null ||
    !("listen" in lock) ||
    typeof lock.listen !== "string" ||
    !lock.listen.trim()
  ) {
    throw new Error(message);
  }
  return lock.listen;
}
