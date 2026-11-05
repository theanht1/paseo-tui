import { expect, it } from "vitest";
import { menuRect, popupRect } from "./popup-layout.js";

it("centers bounded popups and keeps context menus on screen", () => {
  expect(popupRect(120, 40, 80, 24)).toEqual({
    left: 20,
    top: 8,
    width: 80,
    height: 24,
  });
  expect(popupRect(40, 10, 80, 24)).toEqual({
    left: 1,
    top: 1,
    width: 38,
    height: 8,
  });
  expect(menuRect(119, 39, 120, 40)).toEqual({
    left: 98,
    top: 37,
    width: 22,
    height: 3,
  });
});
