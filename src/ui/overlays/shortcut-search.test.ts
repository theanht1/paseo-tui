import { expect, it } from "vitest";
import { helpRows, type Stroke } from "../input/keymap.js";
import { createShortcutSearch, filterShortcuts } from "./shortcut-search.js";

function key(name: string, extra: Partial<Stroke> = {}): Stroke {
  return {
    name,
    sequence: name.length === 1 ? name : "",
    ctrl: false,
    meta: false,
    shift: false,
    ...extra,
  };
}

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

it("opens in normal mode where vim keys scroll instead of typing", () => {
  const search = createShortcutSearch();
  expect(search.getSnapshot()).toEqual({ query: "", focus: "results" });
  expect(search.key(key("j"))).toEqual({ scroll: "line", dir: 1 });
  expect(search.key(key("down"))).toEqual({ scroll: "line", dir: 1 });
  expect(search.key(key("k"))).toEqual({ scroll: "line", dir: -1 });
  expect(search.key(key("up"))).toEqual({ scroll: "line", dir: -1 });
  expect(search.key(key("d", { ctrl: true }))).toEqual({
    scroll: "half",
    dir: 1,
  });
  expect(search.key(key("u", { ctrl: true }))).toEqual({
    scroll: "half",
    dir: -1,
  });
  expect(search.key(key("f", { ctrl: true }))).toEqual({
    scroll: "page",
    dir: 1,
  });
  expect(search.key(key("pageup"))).toEqual({ scroll: "page", dir: -1 });
  expect(search.key(key("g"))).toBe("handled");
  expect(search.key(key("g"))).toEqual({ scroll: "edge", dir: -1 });
  expect(search.key(key("g", { shift: true, sequence: "G" }))).toEqual({
    scroll: "edge",
    dir: 1,
  });
  expect(search.key(key("x"))).toBe("handled");
  expect(search.getSnapshot().query).toBe("");
});

it("/ starts a search; Enter or Esc returns to normal keeping the filter", () => {
  const search = createShortcutSearch();
  expect(search.key(key("/", { sequence: "/" }))).toBe("handled");
  expect(search.getSnapshot().focus).toBe("search");
  expect(search.key(key("j"))).toBe("pass");
  search.change("diff");
  expect(search.key(key("return"))).toBe("handled");
  expect(search.getSnapshot()).toEqual({ query: "diff", focus: "results" });
  search.key(key("i"));
  expect(search.getSnapshot().focus).toBe("search");
  expect(search.key(key("escape"))).toBe("handled");
  expect(search.getSnapshot()).toEqual({ query: "diff", focus: "results" });
});

it("Esc clears the filter before closing; q closes from normal mode", () => {
  const search = createShortcutSearch();
  search.change("quit");
  expect(search.key(key("escape"))).toBe("handled");
  expect(search.getSnapshot().query).toBe("");
  expect(search.key(key("escape"))).toBe("close");
  search.change("quit");
  expect(search.key(key("q"))).toBe("close");
});

it("Ctrl-C leaves the search field and passes from normal mode", () => {
  const search = createShortcutSearch();
  const ctrlC = key("c", { ctrl: true, sequence: "\u0003" });
  search.focus("search");
  search.change("ne");
  expect(search.key(ctrlC)).toBe("handled");
  expect(search.getSnapshot()).toEqual({ query: "ne", focus: "results" });
  expect(search.key(ctrlC)).toBe("pass");
});
