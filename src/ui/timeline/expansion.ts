import { type Block, isExpandable } from "./blocks.js";
export function toggle(
  set: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
export function setAll(
  blocks: readonly Block[],
  expanded: boolean,
): ReadonlySet<string> {
  return new Set(expanded ? blocks.filter(isExpandable).map((b) => b.key) : []);
}
