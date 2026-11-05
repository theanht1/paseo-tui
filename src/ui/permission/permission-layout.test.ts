import { expect, it } from "vitest";
import { permissionHeight } from "./permission-layout.js";

it("reserves title, choices and footer when a tab strip leaves eight pane rows", () => {
  expect(permissionHeight(8, 20, 2)).toBe(6);
  expect(permissionHeight(20, 7, 2)).toBe(9);
});
