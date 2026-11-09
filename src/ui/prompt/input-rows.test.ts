import { expect, test } from "vitest";
import { inputRows } from "./input-rows.js";

test("grows with the wrapped lines between one row and the cap", () => {
  expect(inputRows(0, 6)).toBe(1);
  expect(inputRows(1, 6)).toBe(1);
  expect(inputRows(4, 6)).toBe(4);
  expect(inputRows(9, 6)).toBe(6);
});
