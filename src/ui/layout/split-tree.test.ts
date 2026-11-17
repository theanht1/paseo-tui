import { expect, test } from "vitest";
import {
  assign,
  clearAgent,
  close,
  computeRects,
  cycleFocus,
  focusDirection,
  focusIndex,
  initialLayout,
  moveFocus,
  panes,
  split,
  toggleZoom,
} from "./split-tree.js";

const area = { x: 0, y: 0, width: 120, height: 40 };
test("right then down tree and rectangles", () => {
  const layout = split(split(assign(initialLayout(), "a"), "right"), "down");
  expect(layout.root).toEqual({
    kind: "split",
    direction: "row",
    children: [
      { kind: "pane", id: "0", agentId: "a" },
      {
        kind: "split",
        direction: "column",
        children: [
          { kind: "pane", id: "1", agentId: "a" },
          { kind: "pane", id: "2", agentId: "a" },
        ],
      },
    ],
  });
  expect([...computeRects(layout, area).values()]).toEqual([
    { x: 0, y: 0, width: 59, height: 40 },
    { x: 60, y: 0, width: 60, height: 19 },
    { x: 60, y: 20, width: 60, height: 20 },
  ]);
});
test("same direction adds siblings, close collapses, last close empties", () => {
  let l = split(split(assign(initialLayout(), "a"), "right"), "right");
  expect(l.root.kind === "split" && l.root.children.length).toBe(3);
  l = close(close(l));
  expect(l.root.kind).toBe("pane");
  expect(panes(close(l))[0]?.agentId).toBeNull();
});
test("directional focus in grid and missing neighbour", () => {
  let l = split(initialLayout(), "right");
  l = split(l, "down");
  l = split(focusIndex(l, 0), "down");
  const rects = computeRects(l, area);
  expect(focusDirection(l, "right", rects).focusedId).toBe("2");
  expect(focusDirection(l, "up", rects).focusedId).toBe("0");
  expect(focusDirection(l, "left", rects).focusedId).toBe(l.focusedId);
});
test("zoom clears on split and out of range index does nothing", () => {
  const l = toggleZoom(initialLayout());
  expect(l.zoomedId).toBe("0");
  expect(split(l, "right").zoomedId).toBeNull();
  expect(focusIndex(initialLayout(), 20)).toEqual(initialLayout());
});

test("clearAgent clears every matching pane and preserves others", () => {
  const layout = assign(
    split(split(assign(initialLayout(), "a"), "right"), "down"),
    "b",
  );
  const cleared = clearAgent(layout, "a");
  expect(panes(cleared).map((p) => p.agentId)).toEqual([null, null, "b"]);
  expect(panes(layout).map((p) => p.agentId)).toEqual(["a", "a", "b"]);
  expect(cleared.focusedId).toBe(layout.focusedId);
});
test("left past the leftmost pane reaches the sidebar; right from it returns", () => {
  const l = focusIndex(split(initialLayout(), "right"), 1);
  const rects = computeRects(l, area);
  expect(moveFocus("pane", l, "left", rects)).toEqual({
    target: "pane",
    layout: { ...l, focusedId: "0" },
  });
  const leftmost = focusIndex(l, 0);
  expect(moveFocus("pane", leftmost, "left", rects)).toEqual({
    target: "sidebar",
  });
  expect(moveFocus("pane", leftmost, "up", rects)).toEqual({
    target: "pane",
    layout: leftmost,
  });
  expect(moveFocus("sidebar", leftmost, "right", rects)).toEqual({
    target: "pane",
    layout: leftmost,
  });
  for (const dir of ["left", "up", "down"] as const)
    expect(moveFocus("sidebar", leftmost, dir, rects)).toEqual({
      target: "sidebar",
    });
});
test("cycling visits every pane, then the sidebar, then the first pane again", () => {
  const two = split(initialLayout(), "right");
  const first = focusIndex(two, 0);
  const last = focusIndex(two, 1);
  expect(cycleFocus("pane", first, true)).toEqual({
    target: "pane",
    layout: last,
  });
  expect(cycleFocus("pane", last, true)).toEqual({ target: "sidebar" });
  expect(cycleFocus("sidebar", last, true)).toEqual({
    target: "pane",
    layout: first,
  });
  expect(cycleFocus("pane", initialLayout(), true)).toEqual({
    target: "sidebar",
  });
  expect(cycleFocus("pane", last, false)).toEqual({
    target: "pane",
    layout: first,
  });
});
