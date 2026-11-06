import { expect, it } from "vitest";
import { paletteSize } from "./palette-size.js";

it("a regular palette stays at most 20 rows and fits five commands", () => {
  expect(paletteSize(50, false)).toEqual({ height: 20, capacity: 5 });
  expect(paletteSize(12, false)).toEqual({ height: 12, capacity: 2 });
});

it("a tall palette fills the terminal but its margin and lists far more rows", () => {
  expect(paletteSize(50, true)).toEqual({ height: 48, capacity: 21 });
  expect(paletteSize(24, true)).toEqual({ height: 22, capacity: 8 });
});

it("a tall palette is never shorter than a regular one", () => {
  expect(paletteSize(12, true)).toEqual({ height: 12, capacity: 3 });
  expect(paletteSize(3, true).capacity).toBe(1);
});
