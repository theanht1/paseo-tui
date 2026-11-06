import type { PaseoProject } from "@getpaseo/client";
import type { AgentsPort } from "../../state/ports.js";
import type { WorkspaceActions } from "../workspace/workspace-actions.js";

export type HostStatus = "connected" | "connecting" | "offline" | "idle";
export interface HostOption {
  id: string;
  label: string;
  /** Where the host lives: the daemon address or SSH target. */
  detail: string;
  /** `idle` before its first connection attempt. */
  status: HostStatus;
}
/** What creating workspaces and projects on a host needs from it. */
export interface HostScope {
  id: string;
  label: string;
  projects(): Promise<readonly PaseoProject[]>;
  actions: WorkspaceActions;
  catalog: Pick<AgentsPort, "providers" | "models" | "modes">;
}
export interface HostsPort {
  /** The startup host (localhost by default) first, then the others in the order they were added. */
  list(): readonly HostOption[];
  /** A connected host's projects, actions and catalog; throws when it is not connected. */
  scope(id: string): HostScope;
  /** Connects to verify the address and password, then saves them. */
  add(input: {
    connection: string;
    label: string | null;
    /** The daemon's PASEO_PASSWORD; null when it has none or the address carries it. */
    password: string | null;
  }): Promise<HostOption>;
  /** Retries an offline host; its workspaces join the window once it connects. */
  connect(id: string): Promise<void>;
}
export function hostSubtitle(host: HostOption): string {
  const state = host.status === "idle" ? "not connected" : host.status;
  return `${host.detail} · ${state}`;
}
