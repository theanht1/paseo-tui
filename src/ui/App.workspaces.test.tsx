import type { PaseoAgent } from "@getpaseo/client";
import { expect, it } from "vitest";
import type { CreateAgentInput } from "../state/ports.js";
import { agents, settle, setup } from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

it("closes empty unfocused help with q, leaves normal q inert, and requires a second Ctrl-C", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("?");
  await settle();
  app.stdin.write("q");
  await settle();
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
  expect(ports.get("alpha")?.released).toBe(false);
  app.stdin.write("q");
  await settle();
  expect(ports.get("alpha")?.released).toBe(false);
  app.stdin.write("\u0003");
  await settle();
  expect(app.lastFrame()).toContain("Press Ctrl+C again to quit");
  expect(ports.get("alpha")?.released).toBe(false);
  app.stdin.write("\u0003");
  await settle();
  expect(ports.get("alpha")?.released).toBe(true);
});
it("resizes the sidebar by dragging its divider", async () => {
  const { test } = await setup();
  const divider = test.renderer.root.findDescendantById("sidebar-divider");
  if (!divider) throw Error("Missing draggable divider");
  await test.mockMouse.drag(divider.x, 3, 50, 3);
  await settle();
  expect(test.renderer.root.findDescendantById("sidebar-divider")?.x).toBe(50);
});
it("renders the sidebar cursor with a bright background and dark bold foreground", async () => {
  const { test } = await setup();
  const spans = test.captureSpans().lines.flatMap((line) => line.spans);
  expect(
    spans.some(
      (span) =>
        span.text.includes("/repo/one") &&
        (span.attributes & 1) === 1 &&
        span.bg.toInts().slice(0, 3).join(",") === "130,170,255" &&
        span.fg.toInts().slice(0, 3).join(",") === "16,24,32",
    ),
  ).toBe(true);
});
it("shows workspace rows beneath projects and switches workspace tabs by gt/gT and click", async () => {
  const { app, test, ports } = await setup();
  expect(test.renderer.root.findDescendantById("workspace:one")).toBeDefined();
  expect(test.renderer.root.findDescendantById("tab:agent:beta")).toBeDefined();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("g");
  app.stdin.write("t");
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  app.stdin.write("g");
  app.stdin.write("T");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  const row = test.renderer.root.findDescendantById("tab:agent:beta");
  if (!row) throw Error("Missing tab");
  await test.mockMouse.click(row.x + 1, row.y);
  await settle();
  expect(app.lastFrame()).toContain("hello beta");
  expect(ports.has("beta")).toBe(true);
});

it.each([
  ["Ctrl+C", "\u0003"],
  ["Esc", "\u001b"],
])("keeps the prompt draft when %s leaves insert mode", async (_name, key) => {
  const { app, ports } = await setup();
  for (const input of ["\r", "i", "keep this draft"]) {
    app.stdin.write(input);
    await settle();
  }
  app.stdin.write(key);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(app.lastFrame()).toContain("NORMAL");
  expect(app.lastFrame()).toContain("keep this draft");
  app.stdin.write("i");
  await settle();
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.sent).toEqual(["keep this draft"]);
});
it("expires the quit notice and requires a fresh pair of interrupts", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("\u0003");
  await settle();
  expect(app.lastFrame()).toContain("Press Ctrl+C again to quit");
  await new Promise((resolve) => setTimeout(resolve, 2050));
  await settle();
  expect(app.lastFrame()).not.toContain("Press Ctrl+C again to quit");
  app.stdin.write("\u0003");
  await settle();
  expect(ports.get("alpha")?.released).toBe(false);
  expect(app.lastFrame()).toContain("Press Ctrl+C again to quit");
});
it("types single keys like q into the Command Center query instead of running shortcuts", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write(":");
  await settle();
  expect(app.lastFrame()).toContain("Command Center");
  app.stdin.write("qWr?");
  await settle();
  expect(app.lastFrame()).toContain("Command Center");
  expect(app.lastFrame()).toContain("qWr?");
  expect(app.lastFrame()).not.toContain("New workspace");
  expect(ports.get("alpha")?.released).toBe(false);
});
it("switches to a terminal tab, displays its output, and forwards insert input", async () => {
  const writes: string[] = [];
  const terminal = {
    id: "shell",
    current: () => null,
    refresh: async () => null,
    write(data: string) {
      writes.push(data);
      return data.length;
    },
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: "shell",
      requestId: "r",
      lines: ["ready shell"],
      totalLines: 1,
    }),
    kill: async () => {},
  };
  const { app, test } = await setup(agents, 24, false, {}, undefined, {
    ref: () => terminal,
  });
  const tab = test.renderer.root.findDescendantById("tab:terminal:shell");
  if (!tab) throw Error("Missing terminal tab");
  await test.mockMouse.click(tab.x + 1, tab.y);
  await settle();
  expect(app.lastFrame()).toContain("ready shell");
  app.stdin.write("i");
  await settle();
  app.stdin.write("ls\r");
  await settle();
  expect(writes.join("")).toBe("ls\r");
  for (const key of [
    "\u000e",
    "\u000b",
    "\u0003",
    "\u0003",
    "\u0002",
    "?",
    "W",
    "\u001b",
  ]) {
    app.stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  }
  expect(writes.join("")).toBe("ls\r\u000e\u000b\u0003\u0003\u0002?W\u001b");
  expect(app.lastFrame()).not.toContain("Command Center");
  expect(app.lastFrame()).not.toContain("Press Ctrl+C again");
  expect(app.lastFrame().trimEnd().split("\n").at(-1)).toContain("Ctrl-]");
  app.stdin.write("\u001d");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  app.stdin.write("g");
  app.stdin.write("t");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
});
it("distinguishes the cursor workspace from the active workspace", async () => {
  const { app, test } = await setup();
  for (const key of ["\r", "\t", "j"]) {
    app.stdin.write(key);
    await settle();
  }
  const spans = test.captureSpans().lines.flatMap((line) => line.spans);
  expect(
    spans.some(
      (span) =>
        span.text.includes("/repo/one") &&
        span.bg.toInts().slice(0, 3).join(",") === "40,49,66",
    ),
  ).toBe(true);
  expect(
    spans.some(
      (span) =>
        span.text.includes("/repo/two") &&
        span.bg.toInts().slice(0, 3).join(",") === "130,170,255" &&
        (span.attributes & 1) === 1,
    ),
  ).toBe(true);
});
it("centers a bordered shortcut modal and leaves the content visible around it", async () => {
  const { app, test } = await setup();
  app.stdin.write("?");
  await settle();
  const modal = test.renderer.root.findDescendantById("shortcut-modal");
  if (!modal) throw Error("Missing shortcut modal");
  expect(modal.x).toBeGreaterThan(0);
  expect(modal.y).toBeGreaterThan(0);
  expect(modal.width).toBeLessThan(120);
  expect(app.lastFrame()).toContain("Keyboard shortcuts");
  app.stdin.write("q");
  await settle();
  expect(
    test.renderer.root.findDescendantById("shortcut-modal"),
  ).toBeUndefined();
});
it("keeps the complete shortcuts link at the right of the bottom bar", async () => {
  const { app } = await setup();
  expect(app.lastFrame().trimEnd().split("\n").at(-1)?.trimEnd()).toMatch(
    /\? shortcuts$/,
  );
});
it("shows Working while an agent is running", async () => {
  const { app } = await setup([agent("busy", { status: "running" })]);
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("Working…");
});
it("opens project creation from the sidebar plus and tab creation from the sticky plus", async () => {
  const { app, test } = await setup(agents, 24, false, {}, "agents");
  const add = test.renderer.root.findDescendantById("project-add:repo");
  if (!add) throw Error("Missing project plus");
  await test.mockMouse.click(add.x, add.y);
  await settle();
  expect(app.lastFrame()).toContain("New workspace › Workspace");
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  const tabAdd = test.renderer.root.findDescendantById("tab-add");
  if (!tabAdd) throw Error("Missing tab plus");
  await test.mockMouse.click(tabAdd.x, tabAdd.y);
  await settle();
  expect(app.lastFrame()).toContain("New tab › Tab type");
});
it("right-clicks workspace and tab rows to rename their exact targets", async () => {
  const { app, test } = await setup();
  const workspace = test.renderer.root.findDescendantById("workspace:one");
  if (!workspace) throw Error("Missing workspace");
  await test.mockMouse.click(workspace.x + 2, workspace.y, 2);
  await settle();
  expect(app.lastFrame()).toContain("Rename");
  let rename = test.renderer.root.findDescendantById("context-rename");
  if (!rename) throw Error("Missing rename menu");
  await test.mockMouse.click(rename.x + 1, rename.y);
  await settle();
  expect(app.lastFrame()).toContain("Rename workspace");
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  const tab = test.renderer.root.findDescendantById("tab:agent:beta");
  if (!tab) throw Error("Missing tab");
  await test.mockMouse.click(tab.x + 2, tab.y, 2);
  await settle();
  rename = test.renderer.root.findDescendantById("context-rename");
  if (!rename) throw Error("Missing rename menu");
  await test.mockMouse.click(rename.x + 1, rename.y);
  await settle();
  expect(app.lastFrame()).toContain("Rename tab");
  expect(app.lastFrame()).toContain("Beta agent");
});
it("dims the sidebar title and accents the agent title when pane focus moves", async () => {
  const { app, test } = await setup();
  app.stdin.write("\r");
  await settle();
  const spans = test.captureSpans().lines.flatMap((line) => line.spans);
  expect(
    spans.some(
      (span) =>
        span.text.includes("Projects") &&
        span.fg.toInts().slice(0, 3).join(",") === "112,112,112",
    ),
  ).toBe(true);
  expect(
    spans.some(
      (span) =>
        span.text.includes("Alpha agent") &&
        span.fg.toInts().slice(0, 3).join(",") === "130,170,255",
    ),
  ).toBe(true);
});
it("runs workspace and tab rename from shortcuts and the mouse Apply button", async () => {
  const names: { kind: string; id: string; name: string }[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected create");
    },
    createAgent: async () => agent("new"),
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async (workspace, name) => {
      names.push({ kind: "workspace", id: workspace.id, name });
    },
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async (tab, name) => {
      names.push({ kind: "tab", id: tab.key, name });
    },
  };
  const { app, test } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
    undefined,
    management,
  );
  app.stdin.write("R");
  await settle();
  expect(app.lastFrame()).toContain("Rename workspace");
  app.stdin.write("\u0015");
  app.stdin.write("Renamed worktree");
  await settle();
  const apply = test.renderer.root.findDescendantById("command:submit");
  if (!apply) throw Error("Missing Apply");
  await test.mockMouse.click(apply.x + 2, apply.y);
  await settle();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("r");
  await settle();
  expect(app.lastFrame()).toContain("Rename tab");
  app.stdin.write("\u0015");
  app.stdin.write("Renamed agent");
  app.stdin.write("\r");
  await settle();
  expect(names).toEqual([
    { kind: "workspace", id: "one", name: "Renamed worktree" },
    { kind: "tab", id: "agent:alpha", name: "Renamed agent" },
  ]);
});
it("creates a workspace through project and model configuration, then creates an agent tab in the current workspace", async () => {
  const calls: {
    kind: string;
    id: string;
    input: CreateAgentInput;
    placement?: unknown;
  }[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async (project, input, placement) => {
      calls.push({
        kind: "workspace",
        id: project.projectId,
        input,
        placement,
      });
      return {
        workspace: {
          id: "new-workspace",
          projectId: project.projectId,
          projectRootPath: "/repo",
          workspaceDirectory: "/trees/new",
          name: "New",
        },
        agent: agent("new-agent", { workspaceId: "new-workspace" }),
      };
    },
    createAgent: async (workspace, input) => {
      calls.push({ kind: "agent", id: workspace.id, input });
      return agent("second", { workspaceId: workspace.id });
    },
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
    undefined,
    management,
  );
  for (const key of [
    "W",
    "\r",
    "\u000e",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
    "Workspace agent",
    "\r",
    "Implement feature",
    "\r",
  ]) {
    app.stdin.write(key);
    await settle();
  }
  expect(calls[0]).toMatchObject({
    kind: "workspace",
    id: "repo",
    placement: { kind: "worktree", baseBranch: "main", branchName: null },
    input: {
      provider: "codex",
      model: "best",
      modeId: "ask",
      title: "Workspace agent",
      prompt: "Implement feature",
    },
  });
  // Return to an existing workspace so the fixture's immutable directory can resolve it.
  app.stdin.write("\t");
  await settle();
  app.stdin.write("\r");
  await settle();
  for (const key of [
    "\u000e",
    "\r",
    "\r",
    "\r",
    "\r",
    "Second agent",
    "\r",
    "Second prompt",
    "\r",
  ]) {
    app.stdin.write(key);
    await settle();
  }
  expect(calls[1]).toMatchObject({
    kind: "agent",
    id: "one",
    input: {
      provider: "codex",
      model: "best",
      modeId: "ask",
      title: "Second agent",
      prompt: "Second prompt",
    },
  });
});
it("creates a new tab instantly from the current agent's config, activates it and enters insert mode", async () => {
  const inputs: { workspace: string; input: CreateAgentInput }[] = [];
  const configured = agents.map((value) =>
    value.id === "alpha"
      ? {
          ...value,
          provider: "claude",
          model: "opus",
          currentModeId: "plan",
          thinkingOptionId: "high",
        }
      : value,
  );
  let created: PaseoAgent | null = null;
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected workspace");
    },
    createAgent: async (workspace, input) => {
      inputs.push({ workspace: workspace.id, input });
      created = agent("second", {
        title: "Second agent",
        cwd: "/repo/one",
        workspaceId: workspace.id,
      });
      return created;
    },
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
  const { app, agentsPort } = await setup(
    configured,
    24,
    false,
    {},
    "agents",
    undefined,
    management,
  );
  app.stdin.write("\r");
  await settle();
  app.stdin.write("\u000e");
  await settle();
  expect(inputs).toEqual([
    {
      workspace: "one",
      input: {
        provider: "claude",
        model: "opus",
        modeId: "plan",
        thinkingOptionId: "high",
        cwd: "/repo/one",
        title: null,
        prompt: null,
      },
    },
  ]);
  expect(app.lastFrame()).not.toContain("Provider");
  if (created) agentsPort.handler?.({ kind: "upsert", agent: created });
  await settle();
  expect(app.lastFrame()).toContain("hello second");
  expect(app.lastFrame()).toContain("INSERT");
});
it("keeps the new-tab button pinned at the right edge when tabs overflow", async () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    agent(`agent-${index}`, {
      workspaceId: "one",
      title: `Very long agent ${index}`,
    }),
  );
  const { test } = await setup(many);
  const plus = test.renderer.root.findDescendantById("tab-add");
  if (!plus) throw Error("Missing plus");
  expect(plus.x + plus.width).toBe(120);
  await test.mockMouse.click(plus.x + 1, plus.y);
  await settle();
  expect(test.captureCharFrame()).toContain("New tab");
});
it("moves mouse focus from the sidebar to the existing pane", async () => {
  const { app, test } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("\t");
  await settle();
  await test.mockMouse.click(40, 4);
  await settle();
  const spans = test.captureSpans().lines.flatMap((line) => line.spans);
  expect(
    spans.some(
      (span) =>
        span.text.includes("Projects") &&
        span.fg.toInts().slice(0, 3).join(",") === "112,112,112",
    ),
  ).toBe(true);
});
it("creates a terminal with keyboard and renames it through its mouse menu", async () => {
  const created: string[] = [];
  const renamed: string[] = [];
  const terminal = {
    id: "shell",
    current: () => null,
    refresh: async () => null,
    write: (data: string) => data.length,
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: "shell",
      requestId: "r",
      lines: ["new shell ready"],
      totalLines: 1,
    }),
    kill: async () => {},
  };
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async (workspace) => {
      created.push(workspace.id);
      return {
        id: "shell",
        workspaceId: workspace.id,
        cwd: "/repo/one",
        name: "Shell",
      };
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async (tab, title) => {
      renamed.push(`${tab.key}:${title}`);
    },
  };
  const { app, test } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
    {
      ref: () => terminal,
    },
    management,
  );
  app.stdin.write("\u000e");
  await settle();
  test.mockInput.pressArrow("down");
  test.mockInput.pressEnter();
  await settle();
  expect(created).toEqual(["one"]);
  expect(app.lastFrame()).toContain("new shell ready");
  expect(
    test
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some(
        (span) =>
          span.text.includes("Terminal") &&
          span.fg.toInts().slice(0, 3).join(",") === "130,170,255",
      ),
  ).toBe(true);
  const tab = test.renderer.root.findDescendantById("tab:terminal:shell");
  if (!tab) throw Error("Missing terminal tab");
  await test.mockMouse.click(tab.x + 2, tab.y, 2);
  await settle();
  const rename = test.renderer.root.findDescendantById("context-rename");
  if (!rename) throw Error("Missing rename");
  await test.mockMouse.click(rename.x + 1, rename.y);
  await settle();
  app.stdin.write("\u0015");
  app.stdin.write("Server shell");
  app.stdin.write("\r");
  await settle();
  expect(renamed).toEqual(["terminal:shell:Server shell"]);
});
it("closes management popups with Esc and keeps management keys editable in the agent prompt", async () => {
  const { app, test, ports } = await setup(agents, 24, false, {}, "agents");
  app.stdin.write("W");
  await settle();
  expect(app.lastFrame()).toContain("New workspace");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(app.lastFrame()).not.toContain("New workspace ›");
  app.stdin.write("\r");
  await settle();
  app.stdin.write("i");
  await settle();
  app.stdin.write("WrR");
  await settle();
  expect(app.lastFrame()).toContain("WrR");
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.sent).toEqual(["WrR"]);
});
it("routes Ctrl-N from the shortcut popup to New tab and removes the shortcut overlay", async () => {
  const { app, test } = await setup(agents, 24, false, {}, "agents");
  app.stdin.write("?");
  await settle();
  expect(app.lastFrame()).toContain("Keyboard shortcuts");
  app.stdin.write("\u000e");
  await settle();
  expect(app.lastFrame()).toContain("New tab › Tab type");
  expect(
    test.renderer.root.findDescendantById("shortcut-modal"),
  ).toBeUndefined();
});
it("never opens shortcuts when the tab plus is clicked after entering and leaving input", async () => {
  const { app, test } = await setup(agents, 24, false, {}, "agents");
  for (const key of ["\r", "i", "q?Wrgt"]) {
    app.stdin.write(key);
    await settle();
  }
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  const plus = test.renderer.root.findDescendantById("tab-add");
  if (!plus) throw Error("Missing plus");
  await test.mockMouse.click(plus.x + 1, plus.y);
  await settle();
  expect(app.lastFrame()).toContain("New tab › Tab type");
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
});
it("gives shortcut search at least 60 percent height, filters fuzzy terms, and clears then closes with Esc", async () => {
  const { app, test } = await setup(agents, 60, false, {}, "agents");
  app.stdin.write("?");
  await settle();
  const popup = test.renderer.root.findDescendantById("shortcut-modal");
  if (!popup) throw Error("Missing shortcuts");
  expect(popup.height).toBeGreaterThanOrEqual(36);
  app.stdin.write("/");
  await settle();
  app.stdin.write("renw");
  await settle();
  expect(app.lastFrame()).toContain("Rename workspace");
  expect(app.lastFrame()).not.toContain("Toggle sidebar");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).not.toContain("Toggle sidebar");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(app.lastFrame()).toContain("Toggle sidebar");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(
    test.renderer.root.findDescendantById("shortcut-modal"),
  ).toBeUndefined();
});
it("keeps shortcut characters as text throughout timeline search and rename input", async () => {
  const { app, test } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("/");
  await settle();
  app.stdin.write("q?Wrgt");
  await settle();
  expect(app.lastFrame()).toContain("/q?Wrgt");
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  app.stdin.write("r");
  await settle();
  app.stdin.write("\u0015");
  app.stdin.write("q?Wrgt");
  await settle();
  expect(app.lastFrame()).toContain("q?Wrgt");
  expect(app.lastFrame()).toContain("Rename tab");
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
});
it("places a working line after timeline messages and removes it when the turn finishes", async () => {
  const { app, test, ports } = await setup([
    agent("busy", { status: "running" }),
  ]);
  app.stdin.write("\r");
  await settle();
  const line = test.renderer.root.findDescendantById("timeline-working:busy");
  if (!line) throw Error("Missing inline working line");
  expect(app.lastFrame().indexOf("hello busy")).toBeLessThan(
    app.lastFrame().lastIndexOf("Working…"),
  );
  ports.get("busy")?.handler?.({
    agentId: "busy",
    timestamp: new Date().toISOString(),
    event: { type: "turn_completed", provider: "codex" },
  });
  await settle();
  expect(
    test.renderer.root.findDescendantById("timeline-working:busy"),
  ).toBeUndefined();
});
it("treats q ? W r and gt as text in Command Center filters and the new-workspace prompt", async () => {
  const { app, test } = await setup(agents, 24, false, {}, "agents");
  app.stdin.write(":");
  await settle();
  app.stdin.write("q?Wrgt");
  await settle();
  expect(app.lastFrame()).toContain("q?Wrgt");
  expect(app.lastFrame()).toContain("Command Center");
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  for (const key of ["W", "\r", "\r", "\r", "\r", "\r", "Input test", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("First prompt");
  app.stdin.write("q?Wrgt");
  await settle();
  expect(app.lastFrame()).toContain("q?Wrgt");
  expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
});
it("types q and shortcut letters into the search after /, and closes with q from normal mode", async () => {
  const { app, test } = await setup();
  app.stdin.write("?");
  await settle();
  app.stdin.write("/");
  await settle();
  app.stdin.write("q?Wrgt");
  await settle();
  expect(app.lastFrame()).toContain("q?Wrgt");
  expect(test.renderer.root.findDescendantById("shortcut-modal")).toBeDefined();
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(test.renderer.root.findDescendantById("shortcut-modal")).toBeDefined();
  app.stdin.write("q");
  await settle();
  expect(
    test.renderer.root.findDescendantById("shortcut-modal"),
  ).toBeUndefined();
});
it("shares the persisted thinking selection across new-workspace and new-agent-tab popups", async () => {
  const { loadThinkingPreference } = await import(
    "./agent/thinking-preference.js"
  );
  let config: string | null = null;
  const preference = await loadThinkingPreference({
    read: async () => config,
    write: async (value) => {
      config = value;
    },
  });
  const created: CreateAgentInput[] = [];
  const workspace = {
    id: "one",
    projectId: "repo",
    projectRootPath: "/repo",
    workspaceDirectory: "/repo/one",
    name: "Main",
  };
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async (_, input) => {
      created.push(input);
      return {
        workspace,
        agent: agent("new-workspace-agent", { workspaceId: "one" }),
      };
    },
    createAgent: async (_, input) => {
      created.push(input);
      return agent("new-tab-agent", { workspaceId: "one" });
    },
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
  const { app, test, agentsPort } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
    undefined,
    management,
    preference,
  );
  agentsPort.thinking = {
    kind: "options",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
  };
  for (const key of ["W", "\r", "\r", "\r", "\r", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Thinking");
  const high = test.renderer.root.findDescendantById("command:thinking:high");
  if (!high) throw Error("Missing high thinking");
  await test.mockMouse.click(high.x + 1, high.y);
  await settle();
  for (const key of ["Workspace title", "\r", "q?Wrgt", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(created[0]).toMatchObject({
    thinkingOptionId: "high",
    prompt: "q?Wrgt",
  });
  for (const key of ["\u000e", "\r", "\r", "\r", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Thinking");
  test.mockInput.pressEnter();
  await settle();
  for (const key of ["Tab title", "\r", "Prompt", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(created[1]).toMatchObject({ thinkingOptionId: "high" });
  expect(JSON.parse(config ?? "{}")).toEqual({ thinkingLevel: "high" });
});
it("opens New tab with Ctrl-N from the prompt and timeline search", async () => {
  const { app, test } = await setup(agents, 24, false, {}, "agents");
  for (const keys of [
    ["\r", "i", "draft"],
    ["\r", "/", "query"],
  ]) {
    for (const key of keys) {
      app.stdin.write(key);
      await settle();
    }
    app.stdin.write("\u000e");
    await settle();
    expect(app.lastFrame()).toContain("New tab › Tab type");
    expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
    test.mockInput.pressEscape();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).not.toContain("New tab ›");
  }
});

it("confirms tab closure through ZQ and mouse buttons, and keeps canceled tabs open", async () => {
  const closed: string[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected create");
    },
    createAgent: async () => agent("new"),
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    renameTab: async () => {},
    closeTab: async (tab) => {
      closed.push(tab.key);
    },
    archiveWorkspace: async () => {},
  };
  const { app, test } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    management,
  );
  for (const key of ["\r", "Z", "Q"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(
    test.renderer.root.findDescendantById("close-tab-confirmation"),
  ).toBeDefined();
  app.stdin.write("n");
  await settle();
  expect(closed).toEqual([]);
  const x = test.renderer.root.findDescendantById("tab-close:agent:alpha");
  if (!x) throw Error("Missing close icon");
  await test.mockMouse.click(x.x, x.y);
  await settle();
  const cancel = test.renderer.root.findDescendantById("close-tab-cancel");
  if (!cancel) throw Error("Missing Cancel");
  await test.mockMouse.click(cancel.x, cancel.y);
  await settle();
  expect(closed).toEqual([]);
  for (const key of ["Z", "Q", "y"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(closed).toEqual(["agent:alpha"]);
  expect(
    test.renderer.root.findDescendantById("tab:agent:alpha"),
  ).toBeUndefined();
  expect(app.lastFrame()).toContain("hello beta");
});

it("removes an archived workspace immediately and opens the neighboring agent", async () => {
  const { app, test, removeWorkspace, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  removeWorkspace("one");
  await settle();
  expect(
    test.renderer.root.findDescendantById("tab:agent:alpha"),
  ).toBeUndefined();
  expect(
    test.renderer.root.findDescendantById("tab:agent:beta"),
  ).toBeUndefined();
  expect(
    test.renderer.root.findDescendantById("tab:agent:gamma"),
  ).toBeDefined();
  expect(app.lastFrame()).toContain("hello gamma");
  expect(ports.get("alpha")?.released).toBe(true);
  removeWorkspace("two");
  await settle();
  expect(app.lastFrame()).toContain("No agent");
  expect(app.lastFrame()).not.toContain("hello gamma");
});

it("closes an active terminal when its workspace is archived and opens its neighbor", async () => {
  const terminal = {
    id: "shell",
    current: () => null,
    refresh: async () => null,
    write: (data: string) => data.length,
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: "shell",
      requestId: "r",
      lines: [],
      totalLines: 0,
    }),
    kill: async () => {},
  };
  const { app, test, removeWorkspace } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    {
      ref: () => terminal,
    },
  );
  const tab = test.renderer.root.findDescendantById("tab:terminal:shell");
  if (!tab) throw Error("Missing terminal tab");
  await test.mockMouse.click(tab.x + 1, tab.y);
  await settle();
  removeWorkspace("one");
  await settle();
  expect(
    test.renderer.root.findDescendantById("tab:terminal:shell"),
  ).toBeUndefined();
  expect(app.lastFrame()).toContain("hello gamma");
});

it("cancels a workspace archive from the confirmation by click or n", async () => {
  const archived: string[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected create");
    },
    createAgent: async () => agent("new"),
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    renameTab: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async (workspace) => {
      archived.push(workspace.id);
    },
  };
  const { app, test } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    management,
  );
  async function openConfirmation() {
    const workspace = test.renderer.root.findDescendantById("workspace:one");
    if (!workspace) throw Error("Missing workspace");
    await test.mockMouse.click(workspace.x + 2, workspace.y, 2);
    await settle();
    const archive = test.renderer.root.findDescendantById("context-archive");
    if (!archive) throw Error("Missing workspace archive action");
    await test.mockMouse.click(archive.x + 1, archive.y);
    await settle();
  }
  await openConfirmation();
  const cancel = test.renderer.root.findDescendantById(
    "archive-workspace-cancel",
  );
  if (!cancel) throw Error("Missing Cancel");
  await test.mockMouse.click(cancel.x + 1, cancel.y);
  await settle();
  expect(
    test.renderer.root.findDescendantById("archive-workspace-confirmation"),
  ).toBeUndefined();
  await openConfirmation();
  app.stdin.write("n");
  await settle();
  expect(
    test.renderer.root.findDescendantById("archive-workspace-confirmation"),
  ).toBeUndefined();
  expect(archived).toEqual([]);
  expect(test.renderer.root.findDescendantById("workspace:one")).toBeDefined();
});

it("archives a workspace from its context menu without waiting for a directory event", async () => {
  const archived: string[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected create");
    },
    createAgent: async () => agent("new"),
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    renameTab: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async (workspace) => {
      archived.push(workspace.id);
    },
  };
  const { app, test, ports } = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    undefined,
    management,
  );
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("hello alpha");
  const workspace = test.renderer.root.findDescendantById("workspace:one");
  if (!workspace) throw Error("Missing workspace");
  await test.mockMouse.click(workspace.x + 2, workspace.y, 2);
  await settle();
  const archive = test.renderer.root.findDescendantById("context-archive");
  if (!archive) throw Error("Missing workspace archive action");
  await test.mockMouse.click(archive.x + 1, archive.y);
  await settle();
  expect(archived).toEqual([]);
  expect(
    test.renderer.root.findDescendantById("archive-workspace-confirmation"),
  ).toBeDefined();
  expect(app.lastFrame()).toContain("Archive workspace “/repo/one”?");
  const confirm = test.renderer.root.findDescendantById(
    "archive-workspace-confirm",
  );
  if (!confirm) throw Error("Missing Confirm");
  await test.mockMouse.click(confirm.x + 1, confirm.y);
  await settle();
  expect(archived).toEqual(["one"]);
  expect(
    test.renderer.root.findDescendantById("workspace:one"),
  ).toBeUndefined();
  expect(
    test.renderer.root.findDescendantById("tab:agent:alpha"),
  ).toBeUndefined();
  expect(
    test.renderer.root.findDescendantById("tab:agent:beta"),
  ).toBeUndefined();
  expect(
    test.renderer.root.findDescendantById("tab:agent:gamma"),
  ).toBeDefined();
  expect(app.lastFrame()).toContain("hello gamma");
  expect(ports.get("alpha")?.released).toBe(true);
});
it("scrolls the shortcut list with j/k and G/gg in normal mode instead of typing", async () => {
  const { app, test } = await setup(agents, 24);
  app.stdin.write("?");
  await settle();
  const first = app.lastFrame();
  expect(first).toContain("Keyboard shortcuts");
  for (const key of ["j", "j", "j"]) app.stdin.write(key);
  await settle();
  const scrolled = app.lastFrame();
  expect(scrolled).not.toEqual(first);
  expect(test.renderer.root.findDescendantById("shortcut-modal")).toBeDefined();
  app.stdin.write("G");
  await settle();
  expect(app.lastFrame()).toContain("Insert: Enter send");
  app.stdin.write("g");
  app.stdin.write("g");
  await settle();
  expect(app.lastFrame()).toEqual(first);
});
