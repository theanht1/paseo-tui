import { type Block, blockText } from "./blocks.js";
export function findMatches(blocks: readonly Block[], query: string): string[] {
  return query
    ? blocks
        .filter((b) => blockText(b).toLowerCase().includes(query.toLowerCase()))
        .map((b) => b.key)
    : [];
}
export function nextMatch(
  matches: readonly string[],
  selected: string | null,
  dir: 1 | -1,
): string | null {
  const index = selected === null ? -1 : matches.indexOf(selected);
  return (
    matches[
      index < 0
        ? dir === 1
          ? 0
          : matches.length - 1
        : (index + dir + matches.length) % matches.length
    ] ?? null
  );
}
