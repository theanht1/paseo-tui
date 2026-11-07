import type { HostHealthEntry } from "../../state/host-health.js";

export interface Versions {
  tui: string;
  client: string | null;
}

export function versionRows(
  versions: Versions,
  hosts: readonly HostHealthEntry[],
): string[] {
  const width = Math.max(0, ...hosts.map((host) => host.label.length));
  return [
    `paseo-tui        ${versions.tui}`,
    `@getpaseo/client ${versions.client ?? "unknown"}`,
    "─ hosts ─",
    ...hosts.map((host) => {
      const label = host.label.padEnd(width);
      if (host.health.kind !== "connected")
        return `${label} ${host.health.kind}`;
      const version = host.version;
      const mismatch =
        version &&
        versions.client &&
        version.replace(/^v/, "") !== versions.client.replace(/^v/, "");
      return `${label} daemon ${version ?? "version unknown"}${mismatch ? `   ⚠ differs from client ${versions.client}` : ""}`;
    }),
  ];
}
