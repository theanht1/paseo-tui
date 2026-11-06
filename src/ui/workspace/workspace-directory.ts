import type {
  OwnedSubscription,
  PaseoApi,
  PaseoProject,
  PaseoTerminal,
  PaseoWorkspaceListOptions,
  PaseoWorkspaceListResult,
} from "@getpaseo/client";
import type { TerminalActivity } from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";
import type { ProjectPlacement } from "../hosts/merge.js";
import type { WorkspaceRow } from "./workspaces.js";

type DirectoryList = Omit<PaseoWorkspaceListResult, "subscription"> & {
  subscription?: Pick<
    OwnedSubscription<PaseoWorkspaceListResult>,
    "subscribe" | "release"
  >;
};
export interface DirectoryApi {
  projects: Pick<PaseoApi["projects"], "list" | "subscribe">;
  workspaces: {
    list(options?: PaseoWorkspaceListOptions): Promise<DirectoryList>;
    subscribe: PaseoApi["workspaces"]["subscribe"];
  };
  terminals: {
    list(): Promise<{ entries: readonly DirectoryTerminal[] }>;
  };
}
/** A workspace terminal; `activity` is present when the listing carries it. */
export type DirectoryTerminal = PaseoTerminal & {
  activity?: TerminalActivity | null;
};
export interface DirectorySnapshot {
  projects: readonly PaseoProject[];
  workspaces: readonly WorkspaceRow[];
  terminals: readonly DirectoryTerminal[];
  error: string | null;
  /** Present when several hosts are merged into this view. */
  hosts?: DirectoryHosts;
}
export interface DirectoryHosts {
  /** Each workspace's host name, for the sidebar tag. */
  labels: ReadonlyMap<string, string>;
  /** Where each merged project lives; one entry per host. */
  placements: ReadonlyMap<string, readonly ProjectPlacement[]>;
}
export function createWorkspaceDirectory(api: DirectoryApi) {
  const emitter = createEmitter();
  let snapshot: DirectorySnapshot = {
    projects: [],
    workspaces: [],
    terminals: [],
    error: null,
  };
  let closed = false;
  let loading: Promise<void> | null = null;
  let dirty = false;
  let owned: DirectoryList["subscription"];
  let stopSnapshot: (() => void) | undefined;
  const removed = new Set<string>();
  const stops = [
    api.projects.subscribe(refresh),
    api.workspaces.subscribe((update) => {
      if (closed) return;
      if (update.kind === "remove") {
        removed.add(update.id);
        snapshot = {
          ...snapshot,
          workspaces: snapshot.workspaces.filter((row) => row.id !== update.id),
          terminals: snapshot.terminals.filter(
            (row) => row.workspaceId !== update.id,
          ),
        };
        emitter.notify();
      } else if (update.kind === "upsert") {
        removed.delete(update.workspace.id);
      }
      refresh();
    }),
  ];
  const timer = setInterval(refresh, 3000);
  async function releaseOwned() {
    stopSnapshot?.();
    stopSnapshot = undefined;
    const previous = owned;
    owned = undefined;
    await previous?.release();
  }
  function refresh() {
    if (closed) return;
    if (loading) dirty = true;
    else void load();
  }
  async function fetchDirectory() {
    try {
      const [projects, terminals] = await Promise.all([
        api.projects.list(),
        api.terminals.list(),
      ]);
      const rows: WorkspaceRow[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.workspaces.list({
          page: { limit: 100, ...(cursor ? { cursor } : {}) },
          ...(!cursor ? { subscribe: {} } : {}),
        });
        if (!cursor) {
          await releaseOwned();
          if (closed) {
            await page.subscription?.release();
            return;
          }
          owned = page.subscription;
          stopSnapshot = owned?.subscribe({
            snapshot: () => {},
            update: refresh,
            error: refresh,
          });
        }
        rows.push(...page.entries);
        cursor = page.pageInfo.hasMore
          ? (page.pageInfo.nextCursor ?? undefined)
          : undefined;
      } while (cursor && !closed);
      if (closed) return;
      snapshot = {
        projects: projects.projects,
        workspaces: rows.filter((row) => !removed.has(row.id)),
        terminals: terminals.entries.filter(
          (row) => !removed.has(row.workspaceId),
        ),
        error: null,
      };
    } catch (error) {
      if (closed) return;
      snapshot = { ...snapshot, error: String(error) };
    }
    emitter.notify();
  }
  function load(): Promise<void> {
    if (closed) return Promise.resolve();
    if (loading) return loading;
    loading = fetchDirectory().finally(() => {
      loading = null;
      if (dirty && !closed) {
        dirty = false;
        void load();
      }
    });
    return loading;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    load,
    resync: load,
    async close() {
      closed = true;
      clearInterval(timer);
      for (const stop of stops) stop();
      await releaseOwned();
      emitter.clear();
    },
  };
}
