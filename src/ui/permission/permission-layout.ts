export function permissionHeight(
  paneRows: number,
  contentLines: number,
  actionCount: number,
): number {
  return Math.min(
    contentLines + 2,
    Math.max(Math.min(9, actionCount) + 4, paneRows - 3),
  );
}
