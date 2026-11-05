/** Test helper: the element at `index`, failing the test when it does not exist. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined)
    throw new Error(`expected an element at index ${index} of ${items.length}`);
  return item;
}
