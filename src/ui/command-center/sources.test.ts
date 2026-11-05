import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { createTimelineStore } from "../../state/timeline-store.js";
import { at } from "../../test/at.js";
import { agent, page } from "../../test/fixtures.js";
import { BINDINGS } from "../input/bindings.js";
import type { Action } from "../input/keymap.js";
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
    workspaces: [],
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
    expect(result.layout().focusedId).toBe(at(panes(result.layout()), 1).id);
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
  it("has no Help items and lists every TUI action under Actions", () => {
    const items = setup().items;
    expect(items.some((item) => (item.group as string) === "Help")).toBe(false);
    const titles = items
      .filter((item) => item.group === "Actions")
      .map((item) => item.title);
    for (const title of [
      "New workspace",
      "New tab",
      "Rename workspace",
      "Rename tab",
      "Close tab (confirm)",
      "Copy mode",
      "Edit prompt in $VISUAL/$EDITOR",
      "Keyboard shortcuts",
      "Split right",
      "Split down",
      "Focus left",
      "Next pane",
      "Close pane",
      "Zoom pane",
      "Next workspace tab",
      "Previous workspace tab",
      "Toggle sidebar",
      "Stop running turn",
    ])
      expect(titles).toContain(title);
    expect(new Set(titles).size).toBe(titles.length);
  });
  it("runs each action exactly as its bound shortcut and shows that shortcut", () => {
    const result = setup();
    for (const row of result.items.filter((i) => i.group === "Actions")) {
      result.actions.length = 0;
      row.run();
      expect(result.actions).toHaveLength(1);
      const bound = BINDINGS.filter(
        (b) => JSON.stringify(b.action) === JSON.stringify(result.actions[0]),
      );
      expect(bound.length).toBeGreaterThan(0);
      for (const binding of bound)
        expect(row.shortcut).toContain(
          binding.modes.includes("prefix")
            ? `Ctrl-A ${binding.keys}`
            : binding.keys,
        );
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
    workspaces: [],
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
  expect(at(await step.items(), 0).subtitle).toContain("current");
  expect(at(await step.items(), 1).subtitle).not.toContain("current");
});
it("requires archive confirmation before calling the port", async () => {
  const result = controls(agent("a"));
  const step = result.items.find((item) => item.id === "archive")?.run();
  if (step?.kind !== "confirm") throw Error("missing confirmation");
  expect(result.archived()).toBe(0);
  step.confirm();
  expect(result.archived()).toBe(1);
});
it("offers daemon workspaces with no agents in Command Center", () => {
  const empty = {
    id: "empty",
    projectId: "repo",
    projectRootPath: "/repo",
    workspaceDirectory: "/trees/empty",
    name: "Empty worktree",
  };
  const opened: string[] = [];
  const source = builtinSource({
    groups: [],
    workspaces: [empty],
    focusedAgent: undefined,
    focusedStore: null,
    prefixLabel: "Ctrl-B",
    open() {},
    changeLayout() {},
    workspace(workspace) {
      opened.push(workspace.id);
    },
    act() {},
  });
  const row = source.items().find((item) => item.id === "workspace:empty");
  expect(row?.title).toBe("Empty worktree");
  row?.run();
  expect(opened).toEqual(["empty"]);
});

describe("open file from this chat", () => {
  it("lists the focused chat's files, most recent first, and opens the chosen one", async () => {
    const opened: string[] = [];
    const links = [
      {
        path: "/repo/src/new.ts",
        line: 3,
        col: null,
        raw: "src/new.ts:3",
        source: "text" as const,
      },
      {
        path: "/repo/src/old.ts",
        line: null,
        col: null,
        raw: "/repo/src/old.ts",
        source: "tool" as const,
      },
    ];
    const value = agent("alpha", { cwd: "/repo" });
    const items = builtinSource({
      workspaces: [],
      groups: [],
      focusedAgent: value,
      focusedStore: null,
      prefixLabel: "Ctrl-A",
      open() {},
      changeLayout() {},
      workspace() {},
      act() {},
      files: {
        list: () => links,
        open(link) {
          opened.push(link.path);
        },
      },
    }).items();
    const item = items.find((i) => i.title === "Open file from this chat…");
    const step = item?.run();
    if (step?.kind !== "choice") throw Error("Expected a choice step");
    const choices = await step.items();
    expect(choices.map((choice) => [choice.title, choice.subtitle])).toEqual([
      ["src/new.ts:3", "/repo/src/new.ts"],
      ["src/old.ts", "/repo/src/old.ts"],
    ]);
    choices[1]?.run();
    expect(opened).toEqual(["/repo/src/old.ts"]);
  });
});
