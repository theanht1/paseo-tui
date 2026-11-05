export function sidebarWidth(
  columns: number,
  requested = Math.floor(columns * 0.3),
): number {
  const max = Math.max(0, Math.min(Math.floor(columns / 2), columns - 20));
  return Math.max(Math.min(24, max), Math.min(max, Math.round(requested)));
}
