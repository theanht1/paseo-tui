/**
 * The user's own order of projects, workspaces (per project key), tabs (per
 * workspace id) and pinned workspaces, kept client-side like the desktop app does.
 */
export interface StoredOrder {
  projects: readonly string[];
  workspaces: ReadonlyMap<string, readonly string[]>;
  tabs: ReadonlyMap<string, readonly string[]>;
  pinned: readonly string[];
}
export const NO_ORDER: StoredOrder = {
  projects: [],
  workspaces: new Map(),
  tabs: new Map(),
  pinned: [],
};
export type OrderChange =
  | { kind: "projects"; keys: readonly string[] }
  | { kind: "pinned"; keys: readonly string[] }
  | { kind: "workspaces"; projectKey: string; keys: readonly string[] }
  | { kind: "tabs"; workspaceKey: string; keys: readonly string[] };

/**
 * Stored items present now take the slots stored items occupy, in stored order;
 * other items keep their natural slots; stored keys not present are ignored.
 */
export function applyStoredOrder<T>(
  items: readonly T[],
  stored: readonly string[],
  keyOf: (item: T) => string,
): T[] {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const sequence = [...new Set(stored)].flatMap((key) => {
    const item = byKey.get(key);
    return item === undefined ? [] : [item];
  });
  const slotted = new Set(sequence.map(keyOf));
  let next = 0;
  return items.map((item) =>
    slotted.has(keyOf(item)) ? (sequence[next++] ?? item) : item,
  );
}

/** `applyStoredOrder` with items new to the stored order appended or prepended. */
export function arrange<T>(
  items: readonly T[],
  stored: readonly string[],
  keyOf: (item: T) => string,
  fresh: "append" | "prepend",
): T[] {
  const known = new Set(stored);
  const added = items.map(keyOf).filter((key) => !known.has(key));
  return applyStoredOrder(
    items,
    fresh === "append" ? [...stored, ...added] : [...added, ...stored],
    keyOf,
  );
}

/** The order to store after moving `key` by `delta` among `visible`; null when it cannot move. */
export function moveKey(
  visible: readonly string[],
  key: string,
  delta: number,
  stored: readonly string[],
): string[] | null {
  const from = visible.indexOf(key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= visible.length) return null;
  const moved = visible.filter((candidate) => candidate !== key);
  moved.splice(to, 0, key);
  const shown = new Set(visible);
  return [
    ...new Set([
      ...moved,
      ...stored.filter((candidate) => !shown.has(candidate)),
    ]),
  ];
}
