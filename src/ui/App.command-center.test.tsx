import { describe, expect, it } from "vitest";
import {
  agents,
  rowText,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import { at } from "../test/at.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";
import { createCommandRegistry } from "./command-center/registry.js";

describe("Command Center", () => {
  it("opens a matching agent in the focused pane with Ctrl-K", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\u000b");
    await settle();
    expect(app.lastFrame()).toContain("Command Center");
    app.stdin.write("Beta");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("hello beta");
    expect(ports.has("beta")).toBe(true);
    expect(app.lastFrame()).not.toContain("Command Center");
  });
  it("opens with colon in normal mode and closes with Esc", async () => {
    const { app } = await setup();
    app.stdin.write(":");
    await settle();
    expect(app.lastFrame()).toContain("Command Center");
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).not.toContain("Command Center");
  });
  it("keeps colon editable and restores insert mode after closing", async () => {
    const { app, ports } = await setup();
    for (const key of ["\r", "i", ":", "\u000b"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("Command Center");
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    app.stdin.write("after");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(ports.get("alpha")?.sent).toEqual([":after"]);
  });
  it("runs a clicked result and closes on an outside click", async () => {
    const { app, test } = await setup();
    app.stdin.write(":");
    await settle();
    app.stdin.write("Beta");
    await settle();
    const row = test.renderer.root.findDescendantById("command:agent:beta");
    expect(row).toBeDefined();
    if (!row) throw Error("missing result");
    await test.mockMouse.click(row.x + 1, row.y);
    await settle();
    expect(app.lastFrame()).toContain("hello beta");
    app.stdin.write(":");
    await settle();
    await test.mockMouse.click(0, 0);
    await settle();
    expect(app.lastFrame()).not.toContain("Command Center");
  });
});

it("expands and collapses all idempotently from the palette, keeping O as a toggle", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  port.handler?.({
    agentId: "alpha",
    epoch: "epoch",
    seq: 4,
    timestamp: "2026-11-03T00:00:00Z",
    event: {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "s",
        name: "shell",
        status: "completed",
        error: null,
        detail: {
          type: "shell",
          command: "echo secret",
          output: "secret output",
        },
      },
    },
  });
  await settle();
  for (const query of [
    "Expand all",
    "Expand all",
    "Collapse all",
    "Collapse all",
  ]) {
    app.stdin.write("\u000b");
    await settle();
    app.stdin.write(query);
    await settle();
    app.stdin.write("\r");
    await settle();
    if (query === "Expand all")
      expect(app.lastFrame()).toContain("secret output");
    else expect(app.lastFrame()).not.toContain("secret output");
  }
  app.stdin.write("O");
  await settle();
  expect(app.lastFrame()).toContain("secret output");
  app.stdin.write("O");
  await settle();
  expect(app.lastFrame()).not.toContain("secret output");
});

it("search selects and expands a completed shell tool", async () => {
  const { app, ports, test } = await setup();
  app.stdin.write("\r");
  await settle();
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  port.handler?.({
    agentId: "alpha",
    epoch: "epoch",
    seq: 4,
    timestamp: "2026-11-03T00:00:00Z",
    event: {
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: "shell-search",
        name: "bash",
        status: "completed",
        error: null,
        detail: {
          type: "shell",
          command: "run unique-command",
          output: "shell result",
        },
      },
    },
  });
  await settle();
  app.stdin.write("/");
  await settle();
  await test.mockInput.typeText("unique-command");
  await settle();
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("▌✓ bash");
  expect(app.lastFrame()).toContain("shell result");
});

it("keeps the full search query from a key burst", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  ports.get("alpha")?.pushAssistant(4, "\nheader needle");
  await settle();
  app.stdin.write("/header");
  await settle();
  expect(app.lastFrame()).toContain("/header");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("match 1/1");
  // Markdown paragraphs paint once tree-sitter highlighting (a worker) returns.
  await settleUntil(app.lastFrame, "header needle");
  expect(app.lastFrame()).toContain("header needle");
});

it("expands the newly selected block within a key burst", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  for (const [index, text] of ["first detail", "second detail"].entries()) {
    port.handler?.({
      agentId: "alpha",
      epoch: "epoch",
      seq: 4 + index,
      timestamp: "2026-11-03T00:00:00Z",
      event: {
        type: "timeline",
        provider: "codex",
        item: {
          type: "tool_call",
          callId: `shell-${index}`,
          name: "shell",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "echo", output: text },
        },
      },
    });
  }
  await settle();
  app.stdin.write("}");
  await settle();
  app.stdin.write("}");
  app.stdin.write("o");
  await settle();
  expect(app.lastFrame()).toContain("second detail");
  expect(app.lastFrame()).not.toContain("first detail");
});

it("runs the second Command Center result after Down and Enter in a burst", async () => {
  const { app, test, ports } = await setup();
  app.stdin.write(":");
  await settle();
  test.mockInput.pressArrow("down");
  test.mockInput.pressEnter();
  await settle();
  expect(ports.has("beta")).toBe(true);
  expect(ports.has("alpha")).toBe(false);
});

it("moves the Command Center selection with Ctrl-N and Ctrl-P instead of opening New tab", async () => {
  for (const opener of ["\u000b", ":"]) {
    const { app, ports } = await setup(agents, 24, false, {}, "agents");
    app.stdin.write(opener);
    await settle();
    for (const key of ["\u000e", "\u000e", "\u0010"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).not.toContain("New tab ›");
    expect(app.lastFrame()).toContain("Command Center");
    app.stdin.write("\r");
    await settle();
    expect(ports.has("beta")).toBe(true);
    expect(ports.has("alpha")).toBe(false);
  }
});
it("jumps the Command Center selection with PgDn and PgUp and leaves Home/End to the query", async () => {
  async function opened(keys: string[]) {
    const { app, ports } = await setup(agents, 24, false, {}, "agents");
    app.stdin.write("\u000b");
    await settle();
    for (const key of keys) {
      app.stdin.write(key);
      await settle();
    }
    app.stdin.write("\r");
    await settle();
    return ports;
  }
  expect((await opened([])).has("alpha")).toBe(true);
  expect((await opened(["\u001b[F", "\u001b[H"])).has("alpha")).toBe(true);
  expect((await opened(["\u001b[F"])).has("alpha")).toBe(true);
  expect((await opened(["\u001b[6~"])).has("alpha")).toBe(false);
  expect((await opened(["\u001b[6~", "\u001b[5~"])).has("alpha")).toBe(true);
});

it("moves wizard step selections with Ctrl-N instead of reopening New tab", async () => {
  const { app } = await setup(agents, 24, false, {}, "agents");
  app.stdin.write("\r");
  await settle();
  app.stdin.write("\u000e");
  await settle();
  expect(app.lastFrame()).toContain("New tab › Tab type");
  app.stdin.write("\u000e");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).not.toContain("Provider");
});

it("omits scrollbar colours in every NO_COLOR scrollbox", async () => {
  const many = Array.from({ length: 40 }, (_, index) =>
    agent(`agent-${index}`),
  );
  const { app, test } = await setup(many, 24, false, { NO_COLOR: "1" });
  function expectNoScrollbarColors() {
    for (const line of test.captureSpans().lines) {
      for (const span of line.spans) {
        for (const color of [span.fg, span.bg]) {
          expect(color.toInts().slice(0, 3)).not.toEqual([37, 37, 39]);
          expect(color.toInts().slice(0, 3)).not.toEqual([154, 158, 163]);
        }
      }
    }
  }
  expectNoScrollbarColors();
  app.stdin.write("\r");
  await settle();
  expectNoScrollbarColors();
  app.stdin.write("?");
  await settle();
  expectNoScrollbarColors();
});

it("uses terminal default foreground and background intent for NO_COLOR text", async () => {
  const { app, test } = await setup(agents, 24, false, { NO_COLOR: "1" });
  function expectDefaultForeground() {
    for (const line of test.captureSpans().lines) {
      for (const span of line.spans) {
        if (span.text.trim()) {
          expect(span.fg.intent, span.text).toBe("default");
          expect(span.bg.intent, span.text).toBe("default");
        }
      }
    }
  }
  expectDefaultForeground();
  for (const key of ["\r", "i", "hello", "\u000b", "Beta"]) {
    app.stdin.write(key);
    await settle();
    expectDefaultForeground();
  }
});

const controlAgent = agent("alpha", {
  title: "Alpha agent",
  currentModeId: "ask",
  availableModes: [
    { id: "ask", label: "Ask" },
    { id: "auto", label: "Auto" },
  ],
});
async function controlSetup(command: string) {
  const result = await setup([controlAgent]);
  for (const key of ["\r", "\u000b", command, "\r"]) {
    result.app.stdin.write(key);
    await settle();
  }
  const port = result.ports.get("alpha");
  if (!port) throw Error("missing port");
  return { ...result, port };
}
it("chooses the second mode and returns from steps with Esc", async () => {
  const { app, port, test } = await controlSetup("set mode");
  expect(app.lastFrame()).toContain("Command Center › Set mode");
  test.mockInput.pressArrow("down");
  test.mockInput.pressEnter();
  await settle();
  expect(port.modes).toEqual(["auto"]);
  for (const key of ["\u000b", "set mode", "\r", "\u001b"]) {
    app.stdin.write(key);
    if (key === "\u001b")
      await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  }
  expect(app.lastFrame()).toContain("Command Center");
  expect(app.lastFrame()).not.toContain("› Set mode");
  app.stdin.write("\u001b");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(app.lastFrame()).not.toContain("Command Center");
});
it("prefills rename and submits burst input", async () => {
  const { app, port } = await controlSetup("rename");
  expect(app.lastFrame()).toContain("Alpha agent");
  app.stdin.write("\u0015");
  app.stdin.write("New name");
  app.stdin.write("\r");
  await settle();
  expect(port.names).toEqual(["New name"]);
});
it("archives the open workspace from the Command Center after confirming", async () => {
  const archived: string[] = [];
  const { app } = await setup(agents, 24, false, {}, undefined, undefined, {
    ...NO_PROJECT_ACTIONS,
    baseBranches: async () => ({ branches: [], defaultBranch: null }),
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    openFile: async () => {
      throw Error("Unexpected");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async (workspace) => {
      archived.push(workspace.id);
    },
    renameTab: async () => {},
  });
  for (const key of ["\r", "\u000b", "archive"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Archive workspace…");
  expect(app.lastFrame()).not.toMatch(/Archive Alpha/);
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("Archive workspace “/repo/one”?");
  app.stdin.write("y");
  await settle();
  expect(archived).toEqual(["one"]);
});
it("cycles mode with Shift-Tab and renders a rejected action", async () => {
  const { app, ports, test } = await setup([controlAgent]);
  app.stdin.write("\r");
  await settle();
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  port.modeError = Error("Mode denied");
  test.mockInput.pressTab({ shift: true });
  await settle();
  expect(port.modes).toEqual(["auto"]);
  expect(app.lastFrame()).toContain("Mode denied");
});
it("runs a clicked mode choice", async () => {
  const { port, test } = await controlSetup("set mode");
  const row = test.renderer.root.findDescendantById("command:mode:auto");
  if (!row) throw Error("missing choice");
  await test.mockMouse.click(row.x + 1, row.y);
  await settle();
  expect(port.modes).toEqual(["auto"]);
});

it("loads models asynchronously, marks current/default, and applies a clicked choice", async () => {
  const requested: string[] = [];
  let resolveModels: (
    models: Awaited<ReturnType<NonNullable<AppProps["catalog"]>["models"]>>,
  ) => void = () => {};
  const pending = new Promise<
    Awaited<ReturnType<NonNullable<AppProps["catalog"]>["models"]>>
  >((resolve) => {
    resolveModels = resolve;
  });
  const { app, ports, test } = await setup(
    [agent("alpha", { ...controlAgent, model: "old" })],
    24,
    false,
    {},
    {
      providers: async () => [],
      modes: async () => [],
      onProvidersChange: () => () => {},
      create: async () => {
        throw Error("Unexpected create");
      },
      models(provider) {
        requested.push(provider);
        return pending;
      },
    },
  );
  for (const key of ["\r", "\u000b", "set model", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Loading…");
  expect(requested).toEqual(["codex"]);
  resolveModels([
    { id: "old", label: "Old model", description: null, isDefault: true },
    { id: "new", label: "New model", description: null, isDefault: false },
  ]);
  await settle();
  expect(app.lastFrame()).toContain("current · default");
  const row = test.renderer.root.findDescendantById("command:model:new");
  if (!row) throw Error("missing model row");
  await test.mockMouse.click(row.x + 1, row.y);
  await settle();
  expect(ports.get("alpha")?.models).toEqual(["new"]);
});
it("shows catalog failures and returns to the preserved root query", async () => {
  const { app, test } = await setup(
    [controlAgent],
    24,
    false,
    {},
    {
      providers: async () => [],
      modes: async () => [],
      onProvidersChange: () => () => {},
      create: async () => {
        throw Error("Unexpected create");
      },
      models: async () => {
        throw Error("Catalog unavailable");
      },
    },
  );
  for (const key of ["\r", "\u000b", "set model", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("! Catalog unavailable");
  test.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  expect(app.lastFrame()).not.toContain("Catalog unavailable");
  expect(app.lastFrame()).toContain("set model");
});

it("shows the mode label and provider notice until the next action", async () => {
  const { app, ports, test } = await setup([controlAgent]);
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("codex · Ask · idle");
  const port = ports.get("alpha");
  if (!port) throw Error("missing port");
  port.modeNotice = "Mode applies on next turn";
  test.mockInput.pressTab({ shift: true });
  await settle();
  expect(app.lastFrame()).toContain("Mode applies on next turn");
  port.modeNotice = null;
  test.mockInput.pressTab({ shift: true });
  await settle();
  expect(app.lastFrame()).not.toContain("Mode applies on next turn");
});

it("creates from the focused workspace and keeps the assigned pane pending until subscription delivery", async () => {
  const { app, agentsPort, ports } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
  );
  for (const key of [
    "\r",
    "\u000b",
    "new agent",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
    "hi",
    "\r",
  ]) {
    app.stdin.write(key);
    await settle();
  }
  expect(agentsPort.createdInputs).toEqual([
    {
      provider: "codex",
      model: "best",
      modeId: "ask",
      cwd: "/repo/one",
      title: null,
      prompt: "hi",
    },
  ]);
  expect(app.lastFrame()).toContain("Loading…");
  // A list update before the new snapshot must not clear the pending assignment.
  agentsPort.handler?.({ kind: "upsert", agent: at(agents, 0) });
  await settle();
  expect(app.lastFrame()).toContain("Loading…");
  agentsPort.handler?.({ kind: "upsert", agent: agentsPort.created });
  await settle();
  expect(ports.has("created")).toBe(true);
  expect(app.lastFrame()).toContain("hello created");
});

it("clears a pending creation after ten seconds without a snapshot", async () => {
  const { app } = await setup(agents, 24, false, {}, "agents");
  for (const key of [
    "\r",
    "\u000b",
    "new agent",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
  ]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Loading…");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await settleUntil(() => app.lastFrame(), "No agent.");
  expect(app.lastFrame()).toContain("No agent.");
}, 15_000);

it("shows create errors in the status bar for five seconds", async () => {
  const { app, agentsPort } = await setup(agents, 24, false, {}, "agents");
  agentsPort.createError = Error("Create denied");
  for (const key of [
    "\r",
    "\u000b",
    "new agent",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
    "\r",
  ]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("! Create denied");
  await new Promise((resolve) => setTimeout(resolve, 5050));
  await settle();
  expect(app.lastFrame()).not.toContain("Create denied");
  expect(app.lastFrame()).toContain("hello alpha");
}, 8000);

it("keeps one Provider breadcrumb and the overlay open when an unavailable provider is picked", async () => {
  const { app, agentsPort } = await setup(agents, 24, false, {}, "agents");
  agentsPort.providerAvailable = false;
  for (const key of ["\r", "\u000b", "new agent", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Command Center › Provider");
  for (let attempt = 0; attempt < 2; attempt++) {
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame().match(/Provider/g)).toHaveLength(1);
    expect(app.lastFrame()).toContain("Command Center › Provider");
    expect(app.lastFrame()).toContain("Codex");
    expect(app.lastFrame()).toContain("Sign in required");
    expect(app.lastFrame()).not.toContain("Loading…");
  }
  expect(agentsPort.createdInputs).toEqual([]);
});
it("shows Loading providers… until the catalog loads and re-lists providers when it changes", async () => {
  const { app, agentsPort } = await setup(agents, 24, false, {}, "agents");
  let loaded = () => {};
  agentsPort.providersLoaded = new Promise((resolve) => {
    loaded = resolve;
  });
  agentsPort.providerAvailable = false;
  for (const key of ["\r", "\u000b", "new agent", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("Loading providers…");
  expect(app.lastFrame()).not.toContain("Codex");
  loaded();
  await settle();
  expect(app.lastFrame()).not.toContain("Loading providers…");
  expect(app.lastFrame()).toContain("Sign in required");
  agentsPort.providerAvailable = true;
  for (const listener of agentsPort.providerListeners) listener();
  await settle();
  expect(app.lastFrame()).toContain("Codex");
  expect(app.lastFrame()).not.toContain("Sign in required");
});
it("refreshes providers from the Command Center and says when it is done", async () => {
  let refreshes = 0;
  const { app } = await setup(
    agents,
    24,
    false,
    {},
    "agents",
    undefined,
    undefined,
    undefined,
    {
      refreshProviders: async () => {
        refreshes++;
      },
    },
  );
  for (const key of ["\r", "\u000b", "refresh providers", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(refreshes).toBe(1);
  expect(app.lastFrame()).toContain("Providers refreshed");
});
describe("Command Center shortcut actions", () => {
  async function palette(
    app: Awaited<ReturnType<typeof setup>>["app"],
    query: string,
  ) {
    for (const key of ["\u000b", query]) {
      app.stdin.write(key);
      await settle();
    }
  }
  it("keeps a long title's shortcut on the right edge, from the effective keys", async () => {
    const commands = createCommandRegistry();
    commands.register({
      id: "test",
      items: () => [
        {
          id: "long",
          group: "Actions",
          title: `Zebra ${"very long title ".repeat(8)}end`,
          action: { type: "diff.open" },
          run: () => undefined,
        },
      ],
    });
    const { app, test } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { commands },
    );
    await palette(app, "zebra");
    const row = rowText(test, "command:long");
    expect(row).toContain("Zebra very long");
    expect(row).toMatch(/\.\.\.|…/);
    expect(row.trimEnd().endsWith("end  g d")).toBe(true);
  });
  it("finds actions by their id words, e.g. diff for g d", async () => {
    const { app } = await setup();
    await palette(app, "diff");
    expect(app.lastFrame()).toContain("Open changes (lazygit)");
    expect(app.lastFrame()).toContain("g d");
  });
  it("quits at once from Quit", async () => {
    let exits = 0;
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { onExit: () => exits++ },
    );
    await palette(app, "quit");
    expect(app.lastFrame()).toContain("Ctrl-C Ctrl-C");
    app.stdin.write("\r");
    await settle();
    expect(exits).toBe(1);
  });
  it("starts a timeline search that takes the typed query", async () => {
    const { app } = await setup();
    app.stdin.write("\r");
    await settle();
    await palette(app, "search timeline");
    app.stdin.write("\r");
    await settle();
    app.stdin.write("hello");
    await settle();
    expect(app.lastFrame()).toContain("/hello");
  });
});
