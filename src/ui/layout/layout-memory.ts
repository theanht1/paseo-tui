import { join } from "node:path";
import type { PreferenceStorage } from "../agent/thinking-preference.js";
import { assign, type Layout, type LayoutNode, panes } from "./split-tree.js";

/** Split trees, pane agents, zoom and the selected tab, per workspace, across restarts. */
export interface LayoutMemory {
  /** The last selected tab key of each remembered workspace. */
  tabs(): ReadonlyMap<string, string>;
  /** Remembers a workspace's layout; the write is debounced. */
  record(workspaceId: string, layout: Layout, tab: string | null): void;
  /** The workspace's remembered layout without vanished agents, showing `tabAgentId`. */
  restore(
    workspaceId: string,
    context: { agentIds: ReadonlySet<string>; tabAgentId: string | null },
  ): Layout | null;
  /** Writes any pending change now. */
  flush(): Promise<void>;
}
interface Saved {
  layout: Layout;
  tab: string | null;
}
export type Schedule = (run: () => void, ms: number) => () => void;
export interface LayoutMemoryOptions {
  schedule: Schedule;
  delayMs?: number;
  /** Most recently used workspaces kept in the file. */
  limit?: number;
}

export function layoutsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_STATE_HOME || join(home, ".local", "state"),
    "paseo-tui",
    "layouts.json",
  );
}

export const timerSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseNode(value: unknown): LayoutNode | null {
  if (!isRecord(value)) return null;
  if (
    value.kind === "pane" &&
    typeof value.id === "string" &&
    (value.agentId === null || typeof value.agentId === "string")
  )
    return { kind: "pane", id: value.id, agentId: value.agentId };
  if (
    value.kind === "split" &&
    (value.direction === "row" || value.direction === "column") &&
    Array.isArray(value.children) &&
    value.children.length > 0
  ) {
    const children = value.children.map(parseNode);
    return children.every((child) => child !== null)
      ? { kind: "split", direction: value.direction, children }
      : null;
  }
  return null;
}
function parseSaved(value: unknown): Saved | null {
  if (!isRecord(value) || !isRecord(value.layout)) return null;
  const { layout, tab } = value;
  const root = parseNode(layout.root);
  if (
    !root ||
    typeof layout.focusedId !== "string" ||
    !(layout.zoomedId === null || typeof layout.zoomedId === "string") ||
    typeof layout.nextId !== "number" ||
    !Number.isInteger(layout.nextId) ||
    !(tab === null || typeof tab === "string")
  )
    return null;
  const ids = leafIds(root);
  if (new Set(ids).size !== ids.length) return null;
  const numeric = ids.map(Number).filter(Number.isInteger);
  return {
    layout: fix({
      root,
      focusedId: layout.focusedId,
      zoomedId: layout.zoomedId,
      nextId: Math.max(layout.nextId, ...numeric.map((n) => n + 1)),
    }),
    tab,
  };
}
function parseFile(text: string | null): Map<string, Saved> {
  const saved = new Map<string, Saved>();
  if (text === null) return saved;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return saved;
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.workspaces))
    return saved;
  for (const [id, entry] of Object.entries(parsed.workspaces)) {
    const value = parseSaved(entry);
    if (value) saved.set(id, value);
  }
  return saved;
}

function leafIds(node: LayoutNode): string[] {
  return node.kind === "pane" ? [node.id] : node.children.flatMap(leafIds);
}
/** Keeps focus and zoom on existing panes. */
function fix(layout: Layout): Layout {
  const ids = leafIds(layout.root);
  return {
    ...layout,
    focusedId: ids.includes(layout.focusedId)
      ? layout.focusedId
      : (ids[0] ?? layout.focusedId),
    zoomedId:
      layout.zoomedId && ids.includes(layout.zoomedId) ? layout.zoomedId : null,
  };
}

/** Removes panes showing agents outside `agentIds`, collapsing single-child splits. */
export function pruneLayout(
  layout: Layout,
  agentIds: ReadonlySet<string>,
): Layout {
  function visit(node: LayoutNode): LayoutNode | null {
    if (node.kind === "pane")
      return node.agentId === null || agentIds.has(node.agentId) ? node : null;
    const children = node.children.map(visit).filter((child) => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    return { ...node, children };
  }
  const root = visit(layout.root);
  if (root) return fix({ ...layout, root });
  const id = String(layout.nextId);
  return {
    root: { kind: "pane", id, agentId: null },
    focusedId: id,
    zoomedId: null,
    nextId: layout.nextId + 1,
  };
}

export async function loadLayoutMemory(
  storage: PreferenceStorage,
  { schedule, delayMs = 500, limit = 100 }: LayoutMemoryOptions,
): Promise<LayoutMemory> {
  const saved = parseFile(await storage.read());
  let cancel: (() => void) | null = null;
  let pending = Promise.resolve();
  function write() {
    cancel = null;
    const contents = `${JSON.stringify({
      version: 1,
      workspaces: Object.fromEntries(saved),
    })}\n`;
    pending = pending.catch(() => {}).then(() => storage.write(contents));
    void pending.catch(() => {});
  }
  return {
    tabs: () =>
      new Map(
        [...saved].flatMap(([id, { tab }]): [string, string][] =>
          tab === null ? [] : [[id, tab]],
        ),
      ),
    record(workspaceId, layout, tab) {
      const next = { layout, tab };
      const previous = saved.get(workspaceId);
      if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
      saved.delete(workspaceId);
      saved.set(workspaceId, next);
      for (const id of [...saved.keys()].slice(0, -limit)) saved.delete(id);
      if (!cancel) cancel = schedule(write, delayMs);
    },
    restore(workspaceId, { agentIds, tabAgentId }) {
      const entry = saved.get(workspaceId);
      if (!entry) return null;
      const layout = pruneLayout(entry.layout, agentIds);
      if (tabAgentId === null) return layout;
      const showing = panes(layout).find((pane) => pane.agentId === tabAgentId);
      if (!showing) return assign(layout, tabAgentId);
      return showing.id === layout.focusedId
        ? layout
        : { ...layout, focusedId: showing.id, zoomedId: null };
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
