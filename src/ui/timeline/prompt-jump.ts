import type { SearchTarget } from "./history-search.js";

/**
 * Where a prompt from the prompt index is: its loaded block, or a sequence to page
 * in. `stale` when the index came from another history epoch (after a rewind).
 */
export function promptTarget(
  seq: number,
  owners: ReadonlyMap<number, string>,
  epoch: string | null,
  indexEpoch: string,
): SearchTarget | { kind: "stale" } {
  if (epoch !== indexEpoch) return { kind: "stale" };
  const key = owners.get(seq);
  return key ? { kind: "loaded", key } : { kind: "unloaded", seq };
}
