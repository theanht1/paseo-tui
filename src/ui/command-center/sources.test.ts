import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import { createTimelineStore } from "../../state/timeline-store.js";
import { at } from "../../test/at.js";
import { agent, page, timelineStore } from "../../test/fixtures.js";
import { BINDINGS } from "../input/bindings.js";
import { type Action, shortcutFor } from "../input/keymap.js";
import {
  assign,
  initialLayout,
  type Layout,
  panes,
} from "../layout/split-tree.js";
import type { CommandStep } from "./registry.js";
import { builtinSource } from "./sources.js";

function setup(status: "running" | "idle" = "idle") {
  let layout: Layout = assign(initialLayout(), "old");
  const value = agent("alpha", { title: "Alpha agent", status });
  const actions: Action[] = [];
  const source = builtinSource({
    workspaces: [],
    groups: [{ key: "repo", agents: [value], updatedAt: value.updatedAt }],
    waiting: [],
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
      "Close tab",
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
      const ran = result.actions[0];
      const bound = BINDINGS.filter(
        (b) =>
          JSON.stringify(b.action) ===
          JSON.stringify(ran?.type === "exit" ? { type: "quit" } : ran),
      );
      expect(bound.length).toBeGreaterThan(0);
      const shortcut = row.action
        ? shortcutFor(row.action, BINDINGS, "Ctrl-A")
        : null;
      for (const binding of bound)
        expect(shortcut).toContain(
          binding.modes.includes("prefix")
            ? `Ctrl-A ${binding.keys}`
            : ran?.type === "exit"
              ? `${binding.keys} ${binding.keys}`
              : binding.keys,
        );
    }
  });
  it("gives every hand-built item that has a key binding its shortcut", () => {
    const value = agent("alpha", {
      archivedAt: "2026-11-04T00:00:00Z",
      availableModes: [
        { id: "ask", label: "Ask" },
        { id: "edit", label: "Edit" },
      ],
    });
    const items = builtinSource({
      workspaces: [],
      groups: [],
      waiting: [],
      focusedAgent: value,
      focusedStore: timelineStore(),
      prefixLabel: "Ctrl-B",
      history: {
        history: {
          searchable: true,
          list: async () => ({ entries: [], truncated: false, hostErrors: [] }),
        },
        now: Date.now,
        open() {},
      },
      files: { list: () => [], open() {} },
      unarchive() {},
      open() {},
      changeLayout() {},
      workspace() {},
      act() {},
    }).items();
    const shortcuts = new Map(
      items.map((item) => [
        item.id,
        item.action ? shortcutFor(item.action, BINDINGS, "Ctrl-B") : null,
      ]),
    );
    expect(shortcuts.get("history")).toBe("H");
    expect(shortcuts.get("unarchive")).toBe("u");
    expect(shortcuts.get("open-chat-file")).toBe("F");
    expect(shortcuts.get("expand-all")).toBeNull();
    for (const item of items)
      if (
        item.action &&
        BINDINGS.some(
          (binding) =>
            JSON.stringify(binding.action) === JSON.stringify(item.action),
        )
      )
        expect(
          shortcutFor(item.action, BINDINGS, "Ctrl-B"),
          item.title,
        ).not.toBeNull();
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
    steer: async () => {},
    interrupt: async () => {},
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
    waiting: [],
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
it("leaves archiving an agent to Close tab, and archives the open workspace instead", () => {
  expect(controls(agent("a")).items.some((item) => item.id === "archive")).toBe(
    false,
  );
  const workspace = {
    id: "w",
    projectId: "repo",
    projectRootPath: "/repo",
    activityAt: null,
    statusEnteredAt: null,
    workspaceDirectory: "/repo",
    name: "main",
  };
  const ran: unknown[] = [];
  const manage = {
    workspace,
    hosts: true,
    archiveWorkspace: (target: typeof workspace) =>
      ran.push(["archive", target.id]),
    addProject: () => ran.push("add-project"),
    listProjects: () => ran.push("projects"),
    removeProject: () => ran.push("remove-project"),
    listHosts: () => ran.push("hosts"),
    addHost: () => ran.push("add-host"),
    forkWorkspace: () => ({
      kind: "confirm" as const,
      title: "",
      confirm() {},
    }),
  };
  const items = builtinSource({
    groups: [],
    waiting: [],
    workspaces: [],
    focusedAgent: undefined,
    prefixLabel: "Ctrl-B",
    focusedStore: null,
    open: () => {},
    changeLayout: () => {},
    workspace: () => {},
    act: () => {},
    manage,
  }).items();
  const titles = [
    "Archive workspace…",
    "Add project…",
    "Projects…",
    "Remove project…",
    "Hosts…",
    "Add host…",
  ];
  for (const title of titles) items.find((item) => item.title === title)?.run();
  expect(ran).toEqual([
    ["archive", "w"],
    "add-project",
    "projects",
    "remove-project",
    "hosts",
    "add-host",
  ]);
  const without = builtinSource({
    groups: [],
    waiting: [],
    workspaces: [],
    focusedAgent: undefined,
    prefixLabel: "Ctrl-B",
    focusedStore: null,
    open: () => {},
    changeLayout: () => {},
    workspace: () => {},
    act: () => {},
    manage: { ...manage, workspace: null, hosts: false },
  })
    .items()
    .map((item) => item.title);
  expect(without).not.toContain("Archive workspace…");
  expect(without).not.toContain("Hosts…");
  expect(without).toContain("Add project…");
});
it("offers daemon workspaces with no agents in Command Center", () => {
  const empty = {
    id: "empty",
    projectId: "repo",
    projectRootPath: "/repo",
    activityAt: null,
    statusEnteredAt: null,
    workspaceDirectory: "/trees/empty",
    name: "Empty worktree",
  };
  const opened: string[] = [];
  const source = builtinSource({
    groups: [],
    waiting: [],
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

it("offers Refresh providers under Actions only when the hosts can refresh them", () => {
  let refreshes = 0;
  const context = {
    groups: [],
    waiting: [],
    workspaces: [],
    focusedAgent: undefined,
    focusedStore: null,
    prefixLabel: "Ctrl-B",
    open() {},
    changeLayout() {},
    workspace() {},
    act() {},
  };
  const row = builtinSource({
    ...context,
    refreshProviders() {
      refreshes++;
    },
  })
    .items()
    .find((item) => item.title === "Refresh providers");
  expect(row?.group).toBe("Actions");
  expect(row?.run()).toBeUndefined();
  expect(refreshes).toBe(1);
  expect(
    builtinSource(context)
      .items()
      .some((item) => item.title === "Refresh providers"),
  ).toBe(false);
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
      waiting: [],
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
describe("session history commands", () => {
  function items(focusedAgent: PaseoAgent) {
    const unarchived: string[] = [];
    const source = builtinSource({
      workspaces: [],
      groups: [],
      waiting: [],
      focusedAgent,
      focusedStore: null,
      prefixLabel: "Ctrl-A",
      open() {},
      changeLayout() {},
      workspace() {},
      act() {},
      history: {
        history: {
          searchable: true,
          list: async () => ({ entries: [], truncated: false, hostErrors: [] }),
        },
        now: () => 0,
        open() {},
      },
      unarchive: () => unarchived.push(focusedAgent.id),
    });
    return { items: source.items(), unarchived };
  }
  it("lists History… and offers Unarchive only for an archived focused agent", () => {
    const live = items(agent("live"));
    expect(live.items.find((item) => item.id === "history")?.title).toBe(
      "History…",
    );
    expect(live.items.some((item) => item.id === "unarchive")).toBe(false);
    const archived = items(agent("old", { archivedAt: "2026-11-04" }));
    const unarchive = archived.items.find((item) => item.id === "unarchive");
    expect(unarchive).toMatchObject({ group: "Agent", title: "Unarchive" });
    unarchive?.run();
    expect(archived.unarchived).toEqual(["old"]);
  });
});

describe("clear session command", () => {
  function items(focusedAgent: PaseoAgent, withClear: boolean) {
    const step: CommandStep = {
      kind: "confirm",
      title: "Clear this session? The conversation is reset.",
      confirm() {},
    };
    return builtinSource({
      workspaces: [],
      groups: [],
      waiting: [],
      focusedAgent,
      focusedStore: timelineStore(),
      prefixLabel: "Ctrl-A",
      open() {},
      changeLayout() {},
      workspace() {},
      act() {},
      ...(withClear ? { clear: step } : {}),
    }).items();
  }
  it("lists Clear session in Agent with its key, running the confirm step", () => {
    const item = items(agent("a"), true).find((i) => i.id === "clear-session");
    expect(item).toMatchObject({
      group: "Agent",
      title: "Clear session",
      action: { type: "agent.clear" },
    });
    expect(item?.run()).toMatchObject({ kind: "confirm" });
  });
  it("is absent without a /clear command and for an archived agent", () => {
    expect(items(agent("a"), false).some((i) => i.id === "clear-session")).toBe(
      false,
    );
    expect(
      items(agent("a", { archivedAt: "2026-11-04" }), true).some(
        (i) => i.id === "clear-session",
      ),
    ).toBe(false);
  });
});

describe("archived focused agent", () => {
  function ids(archivedAt: string | null) {
    const value = agent("old", {
      archivedAt,
      model: "best",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: false,
        supportsMcpServers: false,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
      },
      availableModes: [
        { id: "ask", label: "Ask" },
        { id: "auto", label: "Auto" },
      ],
    });
    const source = builtinSource({
      workspaces: [],
      groups: [],
      waiting: [],
      focusedAgent: value,
      focusedStore: timelineStore({
        prompts: async () => ({ epoch: "e", prompts: [] }),
        rewind: async () => {},
        fork: async () => {
          throw Error("Unexpected fork");
        },
        setThinking: async () => {},
      }),
      models: async () => [],
      createAgent: {
        providers: async () => [],
        models: async () => [],
        modes: async () => [],
        create: async () => value,
        workspaces: [],
        defaultCwd: null,
        opened() {},
        failed() {},
      },
      prefixLabel: "Ctrl-A",
      open() {},
      changeLayout() {},
      workspace() {},
      act() {},
      unarchive() {},
    });
    return source.items().map((item) => item.id);
  }
  const mutating = [
    "set-mode",
    "set-model",
    "set-thinking",
    "rewind",
    "rename",
  ];
  it("lists Fork and Unarchive but nothing that changes the agent", () => {
    const live = ids(null);
    for (const id of [...mutating, "fork"]) expect(live).toContain(id);
    const archived = ids("2026-11-04");
    expect(archived).toContain("fork");
    expect(archived).toContain("unarchive");
    for (const id of mutating) expect(archived).not.toContain(id);
  });
});
