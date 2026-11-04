import { expect, test } from "vitest";
import {
  assign,
  clearAgent,
  close,
  computeRects,
  focusDirection,
  focusIndex,
  initialLayout,
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
