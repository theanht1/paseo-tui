import { join } from "node:path";
import type { PreferenceStorage } from "../agent/thinking-preference.js";
import type { ExternalStore } from "../use-store.js";
import {
  NO_ORDER,
  type OrderChange,
  type StoredOrder,
} from "../workspace/ordering.js";
import { type Schedule, timerSchedule } from "./layout-memory.js";

/** The user's project, workspace, tab and pinned order, across restarts. */
export interface OrderMemory extends ExternalStore<StoredOrder> {
  /** Stores one list's new order; the write is debounced. */
  apply(change: OrderChange): void;
  /** Writes any pending change now. */
  flush(): Promise<void>;
}
export interface OrderMemoryOptions {
  schedule: Schedule;
  delayMs?: number;
  /** Most recently reordered workspaces whose tab order is kept. */
  limit?: number;
}

export function orderPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_STATE_HOME || join(home, ".local", "state"),
    "paseo-tui",
    "order.json",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((key): key is string => typeof key === "string")
    : [];
}
function lists(value: unknown): Map<string, readonly string[]> {
  if (!isRecord(value)) return new Map();
  return new Map(
    Object.entries(value).flatMap(([key, list]): [string, string[]][] =>
      Array.isArray(list) ? [[key, keys(list)]] : [],
    ),
  );
}
function parseFile(text: string | null): StoredOrder {
  if (text === null) return NO_ORDER;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_ORDER;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return NO_ORDER;
  return {
    projects: keys(parsed.projects),
    workspaces: lists(parsed.workspaces),
    tabs: lists(parsed.tabs),
    pinned: keys(parsed.pinned),
  };
}
function same(a: readonly string[] | undefined, b: readonly string[]) {
  return a?.length === b.length && a.every((key, index) => key === b[index]);
}
function withList(
  map: ReadonlyMap<string, readonly string[]>,
  key: string,
  list: readonly string[],
  limit = Number.POSITIVE_INFINITY,
) {
  const next = new Map(map);
  next.delete(key);
  next.set(key, list);
  for (const old of [...next.keys()].slice(0, -limit)) next.delete(old);
  return next;
}
function changed(order: StoredOrder, change: OrderChange, limit: number) {
  switch (change.kind) {
    case "projects":
      return same(order.projects, change.keys)
        ? order
        : { ...order, projects: change.keys };
    case "pinned":
      return same(order.pinned, change.keys)
        ? order
        : { ...order, pinned: change.keys };
    case "workspaces":
      return same(order.workspaces.get(change.projectKey), change.keys)
        ? order
        : {
            ...order,
            workspaces: withList(
              order.workspaces,
              change.projectKey,
              change.keys,
            ),
          };
    case "tabs":
      return same(order.tabs.get(change.workspaceKey), change.keys)
        ? order
        : {
            ...order,
            tabs: withList(order.tabs, change.workspaceKey, change.keys, limit),
          };
  }
}

export async function loadOrderMemory(
  storage: PreferenceStorage,
  options: OrderMemoryOptions,
): Promise<OrderMemory> {
  return createOrderMemory(storage, options, parseFile(await storage.read()));
}
function createOrderMemory(
  storage: PreferenceStorage,
  { schedule, delayMs = 500, limit = 200 }: OrderMemoryOptions,
  initial: StoredOrder,
): OrderMemory {
  let order = initial;
  const listeners = new Set<() => void>();
  let cancel: (() => void) | null = null;
  let pending = Promise.resolve();
  function write() {
    cancel = null;
    const contents = `${JSON.stringify({
      version: 1,
      projects: order.projects,
      workspaces: Object.fromEntries(order.workspaces),
      tabs: Object.fromEntries(order.tabs),
      pinned: order.pinned,
    })}\n`;
    pending = pending.catch(() => {}).then(() => storage.write(contents));
    void pending.catch(() => {});
  }
  return {
    getSnapshot: () => order,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply(change) {
      const next = changed(order, change, limit);
      if (next === order) return;
      order = next;
      if (!cancel) cancel = schedule(write, delayMs);
      for (const listener of listeners) listener();
    },
    async flush() {
      if (cancel) {
        cancel();
        write();
      }
      await pending;
    },
  };
}

const NO_STORAGE: PreferenceStorage = {
  read: async () => null,
  write: async () => {},
};
/** An order kept for this run only. */
export function sessionOrderMemory(): OrderMemory {
  return createOrderMemory(NO_STORAGE, { schedule: timerSchedule }, NO_ORDER);
}
