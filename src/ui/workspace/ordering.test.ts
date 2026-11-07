import { expect, it } from "vitest";
import { applyStoredOrder, arrange, moveKey } from "./ordering.js";

const key = (item: string) => item;

it("permutes stored items into the slots stored items occupy", () => {
  expect(applyStoredOrder(["a", "b", "c", "d"], ["d", "b"], key)).toEqual([
    "a",
    "d",
    "c",
    "b",
  ]);
});
it("keeps items missing from the stored order in their natural slots", () => {
  expect(applyStoredOrder(["new", "a", "b"], ["b", "a"], key)).toEqual([
    "new",
    "b",
    "a",
  ]);
});
it("ignores stored keys that are not present, such as filtered or removed items", () => {
  expect(applyStoredOrder(["a", "c"], ["c", "gone", "b", "a"], key)).toEqual([
    "c",
    "a",
  ]);
  expect(applyStoredOrder(["a", "b"], [], key)).toEqual(["a", "b"]);
});
it("uses the first occurrence of a duplicated stored key", () => {
  expect(applyStoredOrder(["a", "b", "c"], ["c", "a", "c"], key)).toEqual([
    "c",
    "b",
    "a",
  ]);
});
it("appends or prepends items that are new to a stored order", () => {
  expect(arrange(["a", "b", "new"], ["b", "a"], key, "append")).toEqual([
    "b",
    "a",
    "new",
  ]);
  expect(arrange(["a", "b", "new"], ["b", "a"], key, "prepend")).toEqual([
    "new",
    "b",
    "a",
  ]);
});
it("keeps the natural order when nothing is stored", () => {
  expect(arrange(["b", "a"], [], key, "prepend")).toEqual(["b", "a"]);
  expect(arrange(["b", "a"], ["gone"], key, "append")).toEqual(["b", "a"]);
});
it("stores the moved visible order followed by stored keys that are not visible", () => {
  expect(moveKey(["a", "b", "c"], "a", 1, ["hidden", "c", "b", "a"])).toEqual([
    "b",
    "a",
    "c",
    "hidden",
  ]);
  expect(moveKey(["a", "b"], "b", -1, [])).toEqual(["b", "a"]);
});
it("cannot move past either end or a key that is not visible", () => {
  expect(moveKey(["a", "b"], "a", -1, [])).toBeNull();
  expect(moveKey(["a", "b"], "b", 1, [])).toBeNull();
  expect(moveKey(["a", "b"], "x", 1, [])).toBeNull();
});
