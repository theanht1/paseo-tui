import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import type {
  WorkspaceLabelChange,
  WorkspaceLabelCursor,
  WorkspaceLabelDefinition,
  WorkspaceLabelEdit,
  WorkspaceLabelList,
  WorkspaceLabelPort,
} from "../connection/ports.js";
import { createEmitter } from "./emitter.js";

export type LabelCatalogSnapshot =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  /** `error` is the last re-list's failure; the labels are then possibly stale. */
  | {
      kind: "ready";
      labels: readonly WorkspaceLabelDefinition[];
      error: string | null;
    };
export interface AssignmentInput {
  workspaceId: string;
  label: WorkspaceLabelDefinition;
  assigned: boolean;
}
/** One host's label catalog, replicated from its snapshot and numbered changes. */
export interface LabelCatalog {
  getSnapshot(): LabelCatalogSnapshot;
  subscribe(listener: () => void): () => void;
  /** Re-lists what changed since the cursor (after a reconnect, a gap or a failed change). */
  load(): Promise<void>;
  setAssignment(input: AssignmentInput): Promise<readonly string[]>;
  update(input: WorkspaceLabelEdit): Promise<WorkspaceLabelDefinition>;
  inspectDelete(name: string): Promise<number>;
  delete(name: string): Promise<number>;
  close(): Promise<void>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** The desktop app's host replica: labels by key and the sync cursor. */
function createReplica() {
  const labels = new Map<string, WorkspaceLabelDefinition>();
  let cursor: WorkspaceLabelCursor | undefined;
  return {
    labels: () => [...labels.values()],
    cursor: () => cursor,
    applyList(payload: WorkspaceLabelList) {
      if (payload.sync.mode === "snapshot") labels.clear();
      for (const removal of payload.sync.removals)
        labels.delete(workspaceLabelKey(removal.name));
      for (const label of payload.labels)
        labels.set(workspaceLabelKey(label.name), label);
      cursor = {
        generation: payload.sync.generation,
        afterSeq: payload.sync.headSeq,
      };
    },
    /** False when the change does not follow the cursor: the caller re-lists. */
    applyChange(change: WorkspaceLabelChange): boolean {
      if (
        !cursor ||
        change.generation !== cursor.generation ||
        change.seq !== cursor.afterSeq + 1
      )
        return false;
      if (change.kind === "remove")
        labels.delete(workspaceLabelKey(change.name));
      else {
        if (change.previousName)
          labels.delete(workspaceLabelKey(change.previousName));
        labels.set(workspaceLabelKey(change.label.name), change.label);
      }
      cursor = { generation: change.generation, afterSeq: change.seq };
      return true;
    },
  };
}

export function createLabelCatalog(port: WorkspaceLabelPort): LabelCatalog {
  const emitter = createEmitter();
  const replica = createReplica();
  let snapshot: LabelCatalogSnapshot = { kind: "loading" };
  let closed = false;
  let inflight: Promise<void> | null = null;
  let again = false;
  function publish(error: string | null) {
    if (closed) return;
    snapshot = { kind: "ready", labels: replica.labels(), error };
    emitter.notify();
  }
  function fail(error: unknown) {
    if (closed) return;
    snapshot =
      snapshot.kind === "ready"
        ? { ...snapshot, error: message(error) }
        : { kind: "failed", error: message(error) };
    emitter.notify();
  }
  const stop = port.observe({
    list(payload) {
      replica.applyList(payload);
      publish(null);
    },
    change(change) {
      if (replica.applyChange(change)) publish(null);
      else void load();
    },
    error: fail,
  });
  /** One listing at a time; a request during it lists once more afterwards. */
  function load(): Promise<void> {
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        again = false;
        try {
          replica.applyList(await port.list(replica.cursor()));
          publish(null);
        } catch (error) {
          fail(error);
        }
      } while (again && !closed);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }
  /** A failed change may mean the replica is stale, so it re-lists before rethrowing. */
  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await load();
      throw error;
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    load,
    setAssignment: (input) => mutate(() => port.setAssignment(input)),
    update: (input) => mutate(() => port.update(input)),
    inspectDelete: (name) => mutate(() => port.inspectDelete(name)),
    delete: (name) => mutate(() => port.delete(name)),
    async close() {
      closed = true;
      emitter.clear();
      await stop();
    },
  };
}

export interface HostLabelCatalog {
  hostId: string;
  labels: readonly WorkspaceLabelDefinition[];
}
/** One definition per key: the target host's first, then other hosts' by id; sorted by name. */
export function mergeLabelCatalogs(
  catalogs: readonly HostLabelCatalog[],
  targetHostId?: string,
): WorkspaceLabelDefinition[] {
  const ordered = [...catalogs].sort((left, right) => {
    if (left.hostId === targetHostId) return -1;
    if (right.hostId === targetHostId) return 1;
    return left.hostId.localeCompare(right.hostId);
  });
  const merged = new Map<string, WorkspaceLabelDefinition>();
  for (const catalog of ordered)
    for (const label of catalog.labels) {
      const key = workspaceLabelKey(label.name);
      if (!merged.has(key)) merged.set(key, label);
    }
  return [...merged.values()].sort(byName);
}
export function byName(
  left: WorkspaceLabelDefinition,
  right: WorkspaceLabelDefinition,
) {
  return left.name.localeCompare(right.name, undefined, {
    sensitivity: "base",
  });
}
/** The definitions behind a workspace's label names, from its own host; unknown names are skipped. */
export function labelDefinitions(
  catalog: readonly WorkspaceLabelDefinition[],
  names: readonly string[] | undefined,
): WorkspaceLabelDefinition[] {
  if (!names?.length) return [];
  const byKey = new Map(
    catalog.map((label) => [workspaceLabelKey(label.name), label]),
  );
  return names.flatMap((name) => {
    const definition = byKey.get(workspaceLabelKey(name));
    return definition ? [definition] : [];
  });
}

export type HostLabelState = { kind: "unsupported" } | LabelCatalogSnapshot;
export interface HostLabels {
  id: string;
  /** The host's name, for choosing whose labels to manage. */
  label: string;
  online: boolean;
  state: HostLabelState;
}
/** Every host's labels as the window uses them. */
export interface WorkspaceLabelsSnapshot {
  /** The labels state of the workspace's host; a catalog survives the host going offline. */
  host(workspaceId: string): HostLabelState;
  /** Every listed catalog merged (an offline host's kept one too), the given workspace's host first. */
  merged(workspaceId: string | null): readonly WorkspaceLabelDefinition[];
  /** Each host's listed catalog (kept while it is offline), sorted by name. */
  catalogs: readonly HostCatalogEntry[];
  /** Some host has labels (`workspaceLabels`). */
  supported: boolean;
  /** Hosts with labels whose listing failed, so nothing is listed for them. */
  failed: readonly { hostId: string; label: string; error: string }[];
  /** Every configured host is online and listed its labels without error (or has none), and one has labels: stale filter keys may go. */
  authoritative: boolean;
}
export interface HostCatalogEntry {
  hostId: string;
  label: string;
  online: boolean;
  labels: readonly WorkspaceLabelDefinition[];
}
/** Assigns through the workspace's own host; edits and deletes on the chosen host. */
export interface WorkspaceLabels {
  getSnapshot(): WorkspaceLabelsSnapshot;
  subscribe(listener: () => void): () => void;
  setAssignment(input: AssignmentInput): Promise<readonly string[]>;
  update(
    hostId: string,
    input: WorkspaceLabelEdit,
  ): Promise<WorkspaceLabelDefinition>;
  inspectDelete(hostId: string, name: string): Promise<number>;
  delete(hostId: string, name: string): Promise<number>;
  /** Lists the host's labels again (after a failed listing). */
  reload(hostId: string): Promise<void>;
}
const UNSUPPORTED: HostLabelState = { kind: "unsupported" };
export function workspaceLabelsView(input: {
  hosts: readonly HostLabels[];
  /** Every configured host's id, including ones still connecting or down. */
  expected: readonly string[];
  hostOf(workspaceId: string): string | null;
}): WorkspaceLabelsSnapshot {
  const { hosts, hostOf } = input;
  const ids = new Set([...input.expected, ...hosts.map((host) => host.id)]);
  const listed = [...ids].every((id) => {
    const host = hosts.find((candidate) => candidate.id === id);
    if (!host) return false;
    if (host.state.kind === "unsupported") return true;
    return (
      host.online && host.state.kind === "ready" && host.state.error === null
    );
  });
  const catalogs = hosts.flatMap((host) =>
    host.state.kind === "ready"
      ? [
          {
            hostId: host.id,
            label: host.label,
            online: host.online,
            labels: [...host.state.labels].sort(byName),
          },
        ]
      : [],
  );
  return {
    host(workspaceId) {
      const id = hostOf(workspaceId);
      return hosts.find((host) => host.id === id)?.state ?? UNSUPPORTED;
    },
    merged: (workspaceId) =>
      mergeLabelCatalogs(
        catalogs,
        (workspaceId ? hostOf(workspaceId) : null) ?? undefined,
      ),
    catalogs,
    failed: hosts.flatMap((host) =>
      host.state.kind === "failed"
        ? [{ hostId: host.id, label: host.label, error: host.state.error }]
        : [],
    ),
    supported: hosts.some((host) => host.state.kind !== "unsupported"),
    authoritative: listed && catalogs.length > 0,
  };
}
