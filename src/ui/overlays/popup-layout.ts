export function popupRect(
  columns: number,
  rows: number,
  desiredWidth: number,
  desiredHeight: number,
) {
  const width = Math.max(1, Math.min(desiredWidth, columns - 2));
  const height = Math.max(1, Math.min(desiredHeight, rows - 2));
  return {
    left: Math.max(0, Math.floor((columns - width) / 2)),
    top: Math.max(0, Math.floor((rows - height) / 2)),
    width,
    height,
  };
}
export function menuRect(
  x: number,
  y: number,
  columns: number,
  rows: number,
  desiredHeight = 3,
) {
  const width = Math.min(22, columns),
    height = Math.min(desiredHeight, rows);
  return {
    left: Math.max(0, Math.min(x, columns - width)),
    top: Math.max(0, Math.min(y, rows - height)),
    width,
    height,
  };
}
