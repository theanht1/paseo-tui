import { expect, it } from "vitest";
import { helpRows } from "../input/keymap.js";
import { createShortcutSearch, filterShortcuts } from "./shortcut-search.js";

it("fuzzy matches keys, descriptions, and sections", () => {
  const rows = helpRows("Ctrl-B");
  expect(
    filterShortcuts(rows, "renw").some(
      (row) => row.description === "Rename workspace",
    ),
  ).toBe(true);
  expect(
    filterShortcuts(rows, "ctrl-n").some(
      (row) => row.description === "New tab",
    ),
  ).toBe(true);
  expect(
    filterShortcuts(rows, "sdebar").some((row) => row.section === "sidebar"),
  ).toBe(true);
  expect(filterShortcuts(rows, "zzzzzzzz")).toEqual([]);
});
it("keeps q editable in search, clears before closing, and only closes q on empty results focus", () => {
  const search = createShortcutSearch();
  expect(
    search.key({
      name: "q",
      sequence: "q",
      ctrl: false,
      meta: false,
      shift: false,
    }),
  ).toBe("pass");
  search.change("quit");
  expect(search.escape()).toBe("handled");
  expect(search.getSnapshot().query).toBe("");
  search.toggleFocus();
  expect(
    search.key({
      name: "q",
      sequence: "q",
      ctrl: false,
      meta: false,
      shift: false,
    }),
  ).toBe("close");
  expect(search.escape()).toBe("close");
});

it("Ctrl-C leaves the search field for the results and passes from results", () => {
  const search = createShortcutSearch();
  const ctrlC = {
    name: "c",
    sequence: "\u0003",
    ctrl: true,
    meta: false,
    shift: false,
  };
  search.change("ne");
  expect(search.key(ctrlC)).toBe("handled");
  expect(search.getSnapshot()).toEqual({ query: "ne", focus: "results" });
  expect(search.key(ctrlC)).toBe("pass");
});
