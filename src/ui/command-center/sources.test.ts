import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { agent, page } from "../../state/test-fixtures.js";
import { createTimelineStore } from "../../state/timeline-store.js";
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
    focusedStore: null,
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

function controls(value: PaseoAgent) {
  let archived = 0;
  const store = createTimelineStore({
    snapshot: () => value,
    fetchTail: async () => page([]),
    fetchAfter: async () => page([]),
    subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
    send: async () => {},
    respondToPermission: async () => {},
    cancel: async () => {},
    setMode: async () => null,
    setModel: async () => {},
    rename: async () => {},
    archive: async () => {
      archived++;
    },
  });
  const source = builtinSource({
    groups: [],
    focusedAgent: value,
    focusedStore: store,
    prefixLabel: "Ctrl-B",
    open() {},
    changeLayout() {},
    workspace() {},
    act() {},
  });
  return { items: source.items(), archived: () => archived };
}
it("hides set mode with fewer than two modes", () => {
  expect(
    controls(agent("a")).items.some((item) => item.id === "set-mode"),
  ).toBe(false);
});
it("marks the current mode in choices", async () => {
  const { items } = controls(
    agent("a", {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", label: "Ask" },
        { id: "auto", label: "Auto" },
      ],
    }),
  );
  const step = items.find((item) => item.id === "set-mode")?.run();
  if (step?.kind !== "choice") throw Error("missing mode choice");
  expect((await step.items())[0].subtitle).toContain("current");
  expect((await step.items())[1].subtitle).not.toContain("current");
});
it("requires archive confirmation before calling the port", async () => {
  const result = controls(agent("a"));
  const step = result.items.find((item) => item.id === "archive")?.run();
  if (step?.kind !== "confirm") throw Error("missing confirmation");
  expect(result.archived()).toBe(0);
  step.confirm();
  expect(result.archived()).toBe(1);
});
