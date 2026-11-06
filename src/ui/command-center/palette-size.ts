/** Border, breadcrumb and input line around the list. */
const CHROME_ROWS = 4;

/**
 * The Command Center's height and how many two-line rows it lists. A regular
 * palette stays at most 20 rows and leaves room for a group header per row; a
 * tall one (long single-group lists such as History) fills the terminal less a
 * one-row margin and budgets a single group header.
 */
export function paletteSize(
  terminalHeight: number,
  tall: boolean,
): { height: number; capacity: number } {
  const regular = Math.min(20, terminalHeight);
  if (!tall)
    return {
      height: regular,
      capacity: Math.max(1, Math.floor((regular - CHROME_ROWS) / 3)),
    };
  const height = Math.max(regular, terminalHeight - 2);
  return {
    height,
    capacity: Math.max(1, Math.floor((height - CHROME_ROWS - 1) / 2)),
  };
}
