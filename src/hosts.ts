import { parseHostTarget } from "@getpaseo/client/node";
import type { Connection } from "./connection/connect.js";
import type { HostConnectionState } from "./connection/ports.js";
import type { HostTarget } from "./connection/target.js";
import { createSession } from "./session.js";
import { createEmitter } from "./state/emitter.js";
import {
  createReconnectSupervisor,
  type HostHealth,
  type HostHealthEntry,
  libraryRetrying,
  nextHealth,
  offlineHealth,
  type Schedule,
} from "./state/host-health.js";
import { type HostRegistry, splitPassword } from "./state/host-registry.js";
import type {
  HostOption,
  HostScope,
  HostStatus,
  HostsPort,
} from "./ui/hosts/hosts.js";
import type { ExternalStore } from "./ui/use-store.js";

/** A connected host: what the UI shows of it and how to let it go. */
export interface HostLive extends Omit<HostScope, "id" | "label"> {
  /** The status bar label, e.g. `local (127.0.0.1:6767)` or `build (tcp://…)`. */
  label: string;
  status: ExternalStore<HostConnectionState>;
  /** The connected daemon's `server_info.version`; null while it is not connected. */
  version(): string | null;
  /** Asks the client library to retry now instead of waiting for its backoff. */
  reconnect(): void;
  close(): Promise<void>;
}
interface HostEntry {
  id: string;
  target: HostTarget;
  label: string;
  saved: string | null;
  /** The daemon's password; null uses the address's or PASEO_PASSWORD. */
  password: string | null;
}
type Attempt<L> =
  | { kind: "connecting"; live: Promise<L> }
  | { kind: "live"; live: L }
  | { kind: "failed" };
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
/** A connected host, as the merged window sees it. */
export interface LiveHost<L> {
  id: string;
  /** The short name the sidebar tags its workspaces with. */
  label: string;
  live: L;
}
/** The address without its credentials (`?password=` never shows). */
function describe(connection: string) {
  try {
    return parseHostTarget(connection).description;
  } catch {
    return "invalid address";
  }
}
function targetId(target: HostTarget) {
  return target.kind === "home"
    ? `home:${target.home}`
    : `host:${describe(target.connection)}`;
}
function status(health: HostHealth): HostStatus {
  return health.kind;
}
/**
 * The startup host plus the saved ones, all connected at once (like the desktop app)
 * and kept until exit. The snapshot is the connected ones, in list order.
 */
export function createHosts<L extends HostLive>(options: {
  initial: { target: HostTarget; live: L };
  /** Timers for retrying hosts the client library does not retry. */
  schedule: Schedule;
  now?: () => number;
  registry: HostRegistry;
  open(
    target: HostTarget,
    label: string | null,
    password: string | null,
  ): Promise<L>;
}) {
  const emitter = createEmitter();
  const initialId = targetId(options.initial.target);
  const initialEntry: HostEntry = {
    id: initialId,
    target: options.initial.target,
    label: options.initial.target.kind === "home" ? "local" : "",
    saved: null,
    password: null,
  };
  const entries: HostEntry[] = [initialEntry];
  function saved(
    connection: string,
    label: string | null,
    password: string | null,
  ): HostEntry {
    return {
      id: targetId({ kind: "host", connection }),
      target: { kind: "host", connection },
      label: label ?? describe(connection),
      saved: label,
      password,
    };
  }
  for (const host of options.registry.list()) {
    const entry = saved(host.connection, host.label, host.password);
    if (entry.id !== initialId) entries.push(entry);
  }
  const now = options.now ?? Date.now;
  const supervisor = createReconnectSupervisor({
    schedule: options.schedule,
    now,
  });
  const attempts = new Map<string, Attempt<L>>();
  const health = new Map<string, HostHealth>();
  const watching = new Map<L, () => void>();
  /** A dead connection kept on screen while its replacement connects. */
  const replacing = new Map<string, L>();
  /** One object per connection, so owners keep matching across health changes. */
  const shown = new WeakMap<L, LiveHost<L>>();
  let closing = false;
  let snapshot: readonly LiveHost<L>[] = [];
  let healthSnapshot: readonly HostHealthEntry[] = [];
  function healthOf(id: string): HostHealth {
    return health.get(id) ?? { kind: "idle" };
  }
  function publish() {
    snapshot = entries.flatMap((host) => {
      const attempt = attempts.get(host.id);
      const live =
        attempt?.kind === "live" ? attempt.live : replacing.get(host.id);
      if (!live) return [];
      const known = shown.get(live);
      if (known) return [known];
      const value = { id: host.id, label: name(host, live), live };
      shown.set(live, value);
      return [value];
    });
    healthSnapshot = entries.map((host) => {
      const attempt = attempts.get(host.id);
      const live = attempt?.kind === "live" ? attempt.live : null;
      const current = healthOf(host.id);
      return {
        id: host.id,
        label: name(host, live),
        health: current,
        version:
          current.kind === "connected" ? (live?.version() ?? null) : null,
      };
    });
    emitter.notify();
  }
  /** Follows a live connection's state; a client that stopped retrying is replaced. */
  function watch(host: HostEntry, live: L) {
    /** The client stopped retrying and a replacement is planned. */
    let gaveUp = false;
    function observe() {
      if (closing) return;
      const attempt = attempts.get(host.id);
      if (attempt?.kind !== "live" || attempt.live !== live) return;
      const state = live.status.getSnapshot();
      const previous = healthOf(host.id);
      const next = nextHealth(previous, state, now());
      if (state.status === "connected") supervisor.reset(host.id);
      if (next.kind !== "offline" || libraryRetrying(state)) {
        // The library retries again: drop the replacement planned when it stopped.
        if (gaveUp) supervisor.reset(host.id);
        gaveUp = false;
        health.set(host.id, next);
      } else if (!gaveUp) {
        gaveUp = true;
        health.set(host.id, {
          ...next,
          nextRetryAt: supervisor.failed(host.id, () => reopen(host)),
        });
      }
      publish();
    }
    watching.set(live, live.status.subscribe(observe));
    observe();
  }
  function unwatch(live: L) {
    watching.get(live)?.();
    watching.delete(live);
  }
  function failed(host: HostEntry, error: unknown) {
    if (closing) return;
    health.set(
      host.id,
      offlineHealth(
        healthOf(host.id),
        now(),
        message(error),
        supervisor.failed(host.id, () => reopen(host)),
      ),
    );
    publish();
  }
  /** Opens a new connection for a host whose old one is gone or never came up. */
  function reopen(host: HostEntry) {
    if (closing) return;
    const current = attempts.get(host.id);
    if (current?.kind === "connecting") return;
    const previous = current?.kind === "live" ? current.live : null;
    if (previous) replacing.set(host.id, previous);
    const live = options.open(host.target, host.saved, host.password).then(
      (value) => {
        replacing.delete(host.id);
        if (closing) {
          void value.close();
          return value;
        }
        attempts.set(host.id, { kind: "live", live: value });
        if (previous) {
          unwatch(previous);
          void previous.close();
        }
        watch(host, value);
        return value;
      },
      (error: unknown) => {
        replacing.delete(host.id);
        attempts.set(
          host.id,
          previous ? { kind: "live", live: previous } : { kind: "failed" },
        );
        failed(host, error);
        throw error;
      },
    );
    attempts.set(host.id, { kind: "connecting", live });
    const before = healthOf(host.id);
    if (before.kind === "offline")
      health.set(host.id, { ...before, nextRetryAt: null });
    else if (!previous) health.set(host.id, { kind: "connecting", attempt: 0 });
    publish();
    live.catch(() => {});
    return live;
  }
  function name(host: HostEntry, live: L | null) {
    if (host.label) return host.label;
    return host.target.kind === "home"
      ? (live?.label ?? host.target.home)
      : describe(host.target.connection);
  }
  function entry(id: string) {
    const found = entries.find((candidate) => candidate.id === id);
    if (!found) throw Error(`Unknown host ${id}`);
    return found;
  }
  function option(host: HostEntry): HostOption {
    const attempt = attempts.get(host.id);
    const live = attempt?.kind === "live" ? attempt.live : null;
    const detail =
      host.target.kind === "home"
        ? (live?.label ?? host.target.home)
        : describe(host.target.connection);
    return {
      id: host.id,
      label: name(host, live),
      detail,
      status: status(healthOf(host.id)),
    };
  }
  /** Connects now: a live host's client retries at once, others reopen with a fresh backoff. */
  function connect(host: HostEntry): Promise<L> {
    const attempt = attempts.get(host.id);
    if (attempt?.kind === "connecting") return attempt.live;
    if (attempt?.kind === "live") {
      const state = attempt.live.status.getSnapshot();
      if (state.status === "connected" || libraryRetrying(state)) {
        if (state.status !== "connected") attempt.live.reconnect();
        return Promise.resolve(attempt.live);
      }
    }
    supervisor.reset(host.id);
    const live = reopen(host);
    if (!live) throw Error("Hosts are closed");
    return live;
  }
  attempts.set(initialId, { kind: "live", live: options.initial.live });
  watch(initialEntry, options.initial.live);
  const startup = Promise.allSettled(
    entries.filter((host) => host.id !== initialId).map(connect),
  );
  const port: HostsPort = {
    list: () => entries.map(option),
    scope(id) {
      const host = entry(id);
      const attempt = attempts.get(id);
      if (attempt?.kind !== "live")
        throw Error(`${option(host).label} is not connected`);
      const { live } = attempt;
      return {
        id,
        label: option(host).label,
        projects: live.projects,
        actions: live.actions,
        catalog: live.catalog,
      };
    },
    async add(input) {
      // A `?password=` typed into the address moves to the password field.
      const split = splitPassword(input.connection);
      const { connection } = split;
      if (!connection) throw Error("Enter a host address");
      const host = saved(
        connection,
        input.label?.trim() || null,
        input.password || split.password,
      );
      if (entries.some((candidate) => candidate.id === host.id))
        throw Error(`${connection} is already saved`);
      const live = await options.open(host.target, host.saved, host.password);
      try {
        await options.registry.add({
          connection,
          label: host.saved,
          password: host.password,
        });
      } catch (error) {
        await live.close();
        throw error;
      }
      entries.push(host);
      attempts.set(host.id, { kind: "live", live });
      watch(host, live);
      return option(host);
    },
    async connect(id) {
      await connect(entry(id));
    },
  };
  return {
    port,
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    /** Every host with its health and daemon version, in list order. */
    health: {
      subscribe: emitter.subscribe,
      getSnapshot: () => healthSnapshot,
    } satisfies ExternalStore<readonly HostHealthEntry[]>,
    /** Settles once every startup connection succeeded or failed. */
    async ready() {
      await startup;
    },
    async close() {
      closing = true;
      supervisor.close();
      for (const stop of watching.values()) stop();
      watching.clear();
      const live = [
        ...replacing.values(),
        ...[...attempts.values()].flatMap((attempt) =>
          attempt.kind === "live" ? [attempt.live] : [],
        ),
      ];
      await Promise.all(live.map((value) => value.close()));
      emitter.clear();
    },
  };
}

/** A host's daemon connection and the session over it. */
export function connectedHost(connection: Connection) {
  const session = createSession(connection);
  return {
    connection,
    session,
    label: connection.label,
    status: session.status,
    version: connection.host.version,
    reconnect: connection.host.reconnect,
    async projects() {
      await session.directory.load();
      return session.directory.getSnapshot().projects;
    },
    actions: session.management,
    catalog: session.agentsPort,
    async close() {
      await session.close();
      await connection.close();
    },
  } satisfies HostLive & Record<string, unknown>;
}
export type ConnectedHost = ReturnType<typeof connectedHost>;
