export interface PaneNode {
  kind: "pane";
  id: string;
  agentId: string | null;
}
export interface SplitNode {
  kind: "split";
  direction: "row" | "column";
  children: readonly LayoutNode[];
}
export type LayoutNode = PaneNode | SplitNode;
export interface Layout {
  root: LayoutNode;
  focusedId: string;
  zoomedId: string | null;
  nextId: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function initialLayout(): Layout {
  return {
    root: { kind: "pane", id: "0", agentId: null },
    focusedId: "0",
    zoomedId: null,
    nextId: 1,
  };
}
function leaves(node: LayoutNode): PaneNode[] {
  return node.kind === "pane" ? [node] : node.children.flatMap(leaves);
}
export function panes(layout: Layout): PaneNode[] {
  return leaves(layout.root);
}
function update(
  node: LayoutNode,
  id: string,
  change: (pane: PaneNode) => LayoutNode,
): LayoutNode {
  return node.kind === "pane"
    ? node.id === id
      ? change(node)
      : node
    : {
        ...node,
        children: node.children.map((child) => update(child, id, change)),
      };
}
export function assign(layout: Layout, agentId: string): Layout {
  return {
    ...layout,
    root: update(layout.root, layout.focusedId, (p) => ({ ...p, agentId })),
  };
}
export function split(layout: Layout, direction: "right" | "down"): Layout {
  const axis = direction === "right" ? "row" : "column";
  const id = String(layout.nextId);
  function visit(node: LayoutNode): LayoutNode {
    if (node.kind === "pane")
      return node.id === layout.focusedId
        ? { kind: "split", direction: axis, children: [node, { ...node, id }] }
        : node;
    const index = node.children.findIndex(
      (c) => c.kind === "pane" && c.id === layout.focusedId,
    );
    if (node.direction === axis && index >= 0) {
      const pane = node.children[index];
      if (pane?.kind === "pane")
        return {
          ...node,
          children: [
            ...node.children.slice(0, index + 1),
            { ...pane, id },
            ...node.children.slice(index + 1),
          ],
        };
    }
    return { ...node, children: node.children.map(visit) };
  }
  return {
    ...layout,
    root: visit(layout.root),
    focusedId: id,
    zoomedId: null,
    nextId: layout.nextId + 1,
  };
}
export function close(layout: Layout): Layout {
  let focusedId = layout.focusedId;
  function visit(node: LayoutNode): LayoutNode {
    if (node.kind === "pane") return { ...node, agentId: null };
    const index = node.children.findIndex(
      (c) => c.kind === "pane" && c.id === layout.focusedId,
    );
    if (index >= 0) {
      const children = node.children.filter((_, i) => i !== index);
      const sibling = children[Math.max(0, index - 1)];
      if (sibling) focusedId = leaves(sibling).at(-1)?.id ?? focusedId;
      return children.length === 1 && children[0]
        ? children[0]
        : { ...node, children };
    }
    return {
      ...node,
      children: node.children.map((c) =>
        leaves(c).some((p) => p.id === layout.focusedId) ? visit(c) : c,
      ),
    };
  }
  const root = visit(layout.root);
  return { ...layout, root, focusedId, zoomedId: null };
}
export function focusIndex(layout: Layout, index: number): Layout {
  const pane = panes(layout)[index];
  return pane ? { ...layout, focusedId: pane.id, zoomedId: null } : layout;
}
export function focusNext(layout: Layout): Layout {
  const all = panes(layout);
  return focusIndex(
    layout,
    (all.findIndex((p) => p.id === layout.focusedId) + 1) % all.length,
  );
}
export function toggleZoom(layout: Layout): Layout {
  return { ...layout, zoomedId: layout.zoomedId ? null : layout.focusedId };
}
export function computeRects(layout: Layout, area: Rect): Map<string, Rect> {
  const result = new Map<string, Rect>();
  function visit(node: LayoutNode, rect: Rect) {
    if (node.kind === "pane") {
      result.set(node.id, rect);
      return;
    }
    const row = node.direction === "row",
      length = row ? rect.width : rect.height;
    const space = Math.max(0, length - node.children.length + 1),
      size = Math.floor(space / node.children.length);
    let offset = 0;
    node.children.forEach((child, i) => {
      const span = i === node.children.length - 1 ? space - size * i : size;
      visit(child, {
        x: rect.x + (row ? offset : 0),
        y: rect.y + (row ? 0 : offset),
        width: row ? span : rect.width,
        height: row ? rect.height : span,
      });
      offset += span + 1;
    });
  }
  visit(layout.root, area);
  return result;
}
export function focusDirection(
  layout: Layout,
  dir: "left" | "right" | "up" | "down",
  rects: ReadonlyMap<string, Rect>,
): Layout {
  const current = rects.get(layout.focusedId);
  if (!current) return { ...layout, zoomedId: null };
  const horizontal = dir === "left" || dir === "right";
  let best: string | null = null,
    distance = Infinity,
    overlapBest = -1;
  for (const [id, r] of rects) {
    if (id === layout.focusedId) continue;
    const gap =
      dir === "left"
        ? current.x - r.x - r.width
        : dir === "right"
          ? r.x - current.x - current.width
          : dir === "up"
            ? current.y - r.y - r.height
            : r.y - current.y - current.height;
    const overlap = horizontal
      ? Math.min(current.y + current.height, r.y + r.height) -
        Math.max(current.y, r.y)
      : Math.min(current.x + current.width, r.x + r.width) -
        Math.max(current.x, r.x);
    if (
      gap >= 0 &&
      overlap > 0 &&
      (gap < distance || (gap === distance && overlap > overlapBest))
    ) {
      best = id;
      distance = gap;
      overlapBest = overlap;
    }
  }
  return { ...layout, focusedId: best ?? layout.focusedId, zoomedId: null };
}
