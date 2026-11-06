import type { ConnectionState } from "@getpaseo/client";
import { parseHostTarget } from "@getpaseo/client/node";
import type { Connection } from "./connection/connect.js";
import type { HostTarget } from "./connection/target.js";
import { createSession } from "./session.js";
import { createEmitter } from "./state/emitter.js";
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
  status: ExternalStore<ConnectionState>;
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
function status(attempt: Attempt<HostLive> | undefined): HostStatus {
  if (!attempt) return "idle";
  if (attempt.kind === "connecting") return "connecting";
  if (attempt.kind === "failed") return "offline";
  return attempt.live.status.getSnapshot().status === "connected"
    ? "connected"
    : "offline";
}
/**
 * The startup host plus the saved ones, all connected at once (like the desktop app)
 * and kept until exit. The snapshot is the connected ones, in list order.
 */
export function createHosts<L extends HostLive>(options: {
  initial: { target: HostTarget; live: L };
  registry: HostRegistry;
  open(
    target: HostTarget,
    label: string | null,
    password: string | null,
  ): Promise<L>;
}) {
  const emitter = createEmitter();
  const initialId = targetId(options.initial.target);
  const entries: HostEntry[] = [
    {
      id: initialId,
      target: options.initial.target,
      label: options.initial.target.kind === "home" ? "local" : "",
      saved: null,
      password: null,
    },
  ];
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
  const attempts = new Map<string, Attempt<L>>([
    [initialId, { kind: "live", live: options.initial.live }],
  ]);
  let snapshot: readonly LiveHost<L>[] = [];
  function publish() {
    snapshot = entries.flatMap((host) => {
      const attempt = attempts.get(host.id);
      return attempt?.kind === "live"
        ? [{ id: host.id, label: name(host, attempt.live), live: attempt.live }]
        : [];
    });
    emitter.notify();
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
      status: status(attempt),
    };
  }
  function connect(host: HostEntry): Promise<L> {
    const attempt = attempts.get(host.id);
    if (attempt?.kind === "live") return Promise.resolve(attempt.live);
    if (attempt?.kind === "connecting") return attempt.live;
    const live = options.open(host.target, host.saved, host.password).then(
      (value) => {
        attempts.set(host.id, { kind: "live", live: value });
        publish();
        return value;
      },
      (error: unknown) => {
        attempts.set(host.id, { kind: "failed" });
        emitter.notify();
        throw error;
      },
    );
    attempts.set(host.id, { kind: "connecting", live });
    return live;
  }
  publish();
  const startup = Promise.allSettled(entries.map(connect));
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
      publish();
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
    /** Settles once every startup connection succeeded or failed. */
    async ready() {
      await startup;
    },
    async close() {
      const live = [...attempts.values()].flatMap((attempt) =>
        attempt.kind === "live" ? [attempt.live] : [],
      );
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
