import { describe, expect, it } from "vitest";
import { agent } from "../../state/test-fixtures.js";
import { type Action, BINDINGS } from "../input/keymap.js";
import {
  assign,
  initialLayout,
  type Layout,
  panes,
} from "../layout/split-tree.js";
import { builtinSource } from "./sources.js";

function setup(status: "running" | "idle" = "idle") {
  let layout: Layout = assign(initialLayout(), "old");
  const value = agent("alpha", { title: "Alpha agent", status });
  const actions: Action[] = [];
  const source = builtinSource({
    groups: [{ key: "repo", agents: [value], updatedAt: value.updatedAt }],
    focusedAgent: value,
    prefixLabel: "Ctrl-A",
    open() {},
    changeLayout(change) {
      layout = change(layout);
    },
    workspace() {},
    act(action) {
      actions.push(action);
    },
  });
  return { items: source.items(), layout: () => layout, actions };
}
describe("built-in commands", () => {
  it("carries agent name, provider, status", () => {
    const row = setup().items.find((i) => i.id === "agent:alpha");
    expect(row?.title).toBe("Alpha agent");
    expect(row?.subtitle).toContain("codex · idle");
  });
  it("splits then assigns, leaving the original pane unchanged", () => {
    const result = setup();
    result.items.find((i) => i.id === "agent:alpha:split")?.run();
    expect(panes(result.layout()).map((p) => p.agentId)).toEqual([
      "old",
      "alpha",
    ]);
    expect(result.layout().focusedId).toBe(panes(result.layout())[1].id);
  });
  it("offers stop only while running", () => {
    expect(setup().items.some((i) => i.id === "stop")).toBe(false);
    expect(setup("running").items.some((i) => i.id === "stop")).toBe(true);
  });
  it("offers separate expand and collapse commands", () => {
    const result = setup();
    result.items.find((item) => item.title === "Expand all")?.run();
    result.items.find((item) => item.title === "Collapse all")?.run();
    expect(result.actions).toEqual([
      { type: "block.expandAll" },
      { type: "block.collapseAll" },
    ]);
  });
  it("uses binding shortcuts for pane actions", () => {
    for (const row of setup().items.filter((i) => i.group === "Panes")) {
      const binding = BINDINGS.find((b) => b.description === row.title);
      expect(row.shortcut).toBe(`Ctrl-A ${binding?.keys}`);
    }
  });
});
