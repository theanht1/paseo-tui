import { expect, it } from "vitest";
import { sidebarWidth } from "./sidebar-width.js";

it("clamps dragged width while reserving room for the editor even on small terminals", () => {
  expect(sidebarWidth(120, 50)).toBe(50);
  expect(sidebarWidth(120, -10)).toBe(24);
  expect(sidebarWidth(120, 200)).toBe(60);
  expect(sidebarWidth(30, 50)).toBe(10);
  expect(sidebarWidth(1, 50)).toBe(0);
  expect(sidebarWidth(120)).toBe(36);
});
