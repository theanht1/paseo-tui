// Copied from getpaseo/paseo packages/server/src/server/local-credential.ts @ 0.15.0; keep in sync.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeLoopbackToLocalhost,
  parseConnectionUri,
} from "@getpaseo/protocol/daemon-endpoints";

const FILE_NAME = "local-credential";

export function readLocalCredential(home: string): string | null {
  try {
    const token = readFileSync(join(home, FILE_NAME), "utf8").trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

function normalizeTarget(target: string): string | null {
  try {
    const trimmed = target.trim();
    if (trimmed.startsWith("tcp://")) {
      const parsed = parseConnectionUri(trimmed);
      const endpoint = parsed.isIpv6
        ? `[${parsed.host}]:${parsed.port}`
        : `${parsed.host}:${parsed.port}`;
      return normalizeLoopbackToLocalhost(endpoint);
    }
    if (trimmed.startsWith("unix://") || trimmed.startsWith("pipe://"))
      return trimmed;
    if (trimmed.startsWith("/")) return `unix://${trimmed}`;
    if (trimmed.startsWith("\\\\.\\pipe\\")) return `pipe://${trimmed}`;
    if (/^\d+$/.test(trimmed)) return `localhost:${trimmed}`;
    return normalizeLoopbackToLocalhost(trimmed);
  } catch {
    return null;
  }
}

export function readLocalCredentialForTarget(
  home: string,
  target: string,
): string | null {
  try {
    const lock: unknown = JSON.parse(
      readFileSync(join(home, "paseo.pid"), "utf8"),
    );
    if (
      typeof lock !== "object" ||
      lock === null ||
      !("listen" in lock) ||
      typeof lock.listen !== "string"
    )
      return null;
    const selected = normalizeTarget(target);
    const listening = normalizeTarget(lock.listen);
    if (!selected || !listening || selected !== listening) return null;
    return readLocalCredential(home);
  } catch {
    return null;
  }
}
