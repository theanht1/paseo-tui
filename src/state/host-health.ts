import type { HostConnectionState as ConnectionState } from "../connection/ports.js";

/** One host's connection as the window shows it. */
export type HostHealth =
  | { kind: "connected" }
  | { kind: "connecting"; attempt: number }
  | {
      kind: "offline";
      since: number;
      lastError: string | null;
      /** Epoch ms of the next retry; null while one is running or none is planned. */
      nextRetryAt: number | null;
    }
  | { kind: "idle" };
export interface HostHealthEntry {
  id: string;
  /** The short name the sidebar and notices use. */
  label: string;
  health: HostHealth;
  /** The connected daemon's `server_info.version`; null while it is not connected. */
  version: string | null;
}
export type Schedule = (run: () => void, ms: number) => () => void;

/** Offline since the outage began, with the newest error and retry time. */
export function offlineHealth(
  previous: HostHealth,
  now: number,
  lastError: string | null,
  nextRetryAt: number | null,
): HostHealth {
  return {
    kind: "offline",
    since: previous.kind === "offline" ? previous.since : now,
    lastError:
      lastError ?? (previous.kind === "offline" ? previous.lastError : null),
    nextRetryAt,
  };
}
/** The health after the client library reports `state`; a retry inside an outage keeps it offline. */
export function nextHealth(
  previous: HostHealth,
  state: ConnectionState,
  now: number,
): HostHealth {
  switch (state.status) {
    case "connected":
      return { kind: "connected" };
    case "connecting":
      return previous.kind === "offline"
        ? previous
        : { kind: "connecting", attempt: state.attempt };
    case "disconnected":
      return offlineHealth(
        previous,
        now,
        state.reason ?? null,
        state.nextRetryAt ? Date.parse(state.nextRetryAt) : null,
      );
    case "idle":
    case "disposed":
      return offlineHealth(previous, now, null, null);
  }
}
/** True while the client library will reconnect on its own. */
export function libraryRetrying(state: ConnectionState): boolean {
  return (
    state.status === "connecting" ||
    (state.status === "disconnected" && state.nextRetryAt !== undefined)
  );
}
const BACKOFF_MS = [5000, 10000, 30000];
/** The wait before retry number `failures` (from 0): 5 s, 10 s, 30 s, then every 60 s. */
export function retryDelay(failures: number): number {
  return BACKOFF_MS[failures] ?? 60000;
}
/** Status-line notices for hosts that dropped or came back since `previous`. */
export function healthNotices(
  previous: readonly HostHealthEntry[],
  next: readonly HostHealthEntry[],
): string[] {
  const before = new Map(previous.map((entry) => [entry.id, entry.health]));
  return next.flatMap((entry) => {
    const was = before.get(entry.id)?.kind;
    if (was === "connected" && entry.health.kind === "offline")
      return [`${entry.label} went offline · retrying`];
    if (was === "offline" && entry.health.kind === "connected")
      return [`${entry.label} reconnected`];
    return [];
  });
}
/** ` +2 hosts · 1 offline` after the startup host's name; empty with one host. */
export function hostsSummary(entries: readonly HostHealthEntry[]): string {
  const others = entries.length - 1;
  if (others <= 0) return "";
  const offline = entries.filter(
    (entry) => entry.health.kind === "offline",
  ).length;
  return ` +${others} host${others === 1 ? "" : "s"}${offline ? ` · ${offline} offline` : ""}`;
}
/**
 * Retries hosts the client library is not retrying (a failed first connection, or a
 * client that stopped), backing off per host until `reset`.
 */
export function createReconnectSupervisor(options: {
  schedule: Schedule;
  now(): number;
}) {
  const hosts = new Map<string, { failures: number; cancel: () => void }>();
  function cancel(id: string) {
    hosts.get(id)?.cancel();
  }
  return {
    /** Schedules `retry` after the host's next backoff step; returns when it runs. */
    failed(id: string, retry: () => void): number {
      cancel(id);
      const failures = hosts.get(id)?.failures ?? 0;
      const delay = retryDelay(failures);
      hosts.set(id, {
        failures: failures + 1,
        cancel: options.schedule(retry, delay),
      });
      return options.now() + delay;
    },
    /** Forgets the host's backoff and any planned retry (it connected, or the user retries now). */
    reset(id: string) {
      cancel(id);
      hosts.delete(id);
    },
    close() {
      for (const host of hosts.values()) host.cancel();
      hosts.clear();
    },
  };
}
