import type {
  ConnectionState,
  PaseoAgent,
  PaseoAgentTimelineEvent,
  PaseoAgentUpdate,
} from "@getpaseo/client";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentTimelineItem,
} from "@getpaseo/protocol/agent-types";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { afterEach, describe, expect, it } from "vitest";
import { rendererOptions } from "../cli.js";
import { createAgentsStore } from "../state/agents-store.js";
import type { AgentPort, AgentsList, AgentsPort } from "../state/ports.js";
import { agent, listSnapshot, page } from "../state/test-fixtures.js";
import { createTimelineRegistry } from "../state/timeline-registry.js";
import { createTimelineStore } from "../state/timeline-store.js";
import { App } from "./App.js";
import { watchConnection } from "./connection-status.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "./render/theme.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

class FakeAgents implements AgentsPort {
  lists = 0;
  constructor(public agents: PaseoAgent[]) {}
  async list(): Promise<AgentsList> {
    this.lists++;
    const snapshot = listSnapshot(this.agents);
    return {
      ...snapshot,
      subscription: {
        release: async () => {},
        subscribe: (observer) => {
          observer.snapshot(snapshot);
          return () => {};
        },
      },
    };
  }
  onUpdate(_handler: (update: PaseoAgentUpdate) => void) {
    return () => {};
  }
}
class FakeAgent implements AgentPort {
  sent: string[] = [];
  responses: { id: string; response: AgentPermissionResponse }[] = [];
  canceled = 0;
  sendError: Error | null = null;
  responseError: Error | null = null;
  cancelError: Error | null = null;
  sendGate: Promise<void> = Promise.resolve();
  responseGate: Promise<void> = Promise.resolve();
  cancelGate: Promise<void> = Promise.resolve();
  handler: ((event: PaseoAgentTimelineEvent) => void) | null = null;
  released = false;
  constructor(
    readonly current: PaseoAgent,
    readonly items: AgentTimelineItem[],
  ) {}
  subscribe(handler: (event: PaseoAgentTimelineEvent) => void) {
    this.handler = handler;
    return Object.assign(
      () => {
        this.released = true;
      },
      { ready: Promise.resolve() },
    );
  }
  async fetchTail() {
    const seqs = this.items.map((_, index) => index + 1);
    const tail = page(seqs);
    return {
      ...tail,
      entries: tail.entries.map((entry, index) => ({
        ...entry,
        item: this.items[index],
      })),
    };
  }
  async fetchAfter(): Promise<never> {
    throw new Error("unexpected catch-up");
  }
  async send(text: string) {
    this.sent.push(text);
    await this.sendGate;
    if (this.sendError) throw this.sendError;
  }
  async respondToPermission(id: string, response: AgentPermissionResponse) {
    this.responses.push({ id, response });
    await this.responseGate;
    if (this.responseError) throw this.responseError;
  }
  async cancel() {
    this.canceled++;
    await this.cancelGate;
    if (this.cancelError) throw this.cancelError;
  }
  snapshot() {
    return this.current;
  }
  requestPermission(request: AgentPermissionRequest) {
    this.handler?.({
      agentId: this.current.id,
      timestamp: "2026-11-03T00:00:00Z",
      event: { type: "permission_requested", provider: "codex", request },
    });
  }
  pushAssistant(seq: number, text: string) {
    this.handler?.({
      agentId: this.current.id,
      epoch: "epoch",
      seq,
      timestamp: "2026-11-03T00:00:00Z",
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", text },
      },
    });
  }
}
class FakeConnection {
  listeners = new Set<(state: ConnectionState) => void>();
  onConnectionState(cb: (state: ConnectionState) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
  emit(state: ConnectionState) {
    for (const listener of this.listeners) listener(state);
  }
}
const renders: (() => Promise<void>)[] = [];
async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    for (const render of renders) await render();
  }
}

const agents = [
  agent("alpha", {
    title: "Alpha agent",
    cwd: "/repo/one",
    workspaceId: "one",
    updatedAt: "2026-11-03T00:00:02Z",
  }),
  agent("beta", {
    title: "Beta agent",
    cwd: "/repo/one",
    workspaceId: "one",
    updatedAt: "2026-11-03T00:00:01Z",
  }),
  agent("gamma", {
    title: "Gamma agent",
    cwd: "/repo/two",
    workspaceId: "two",
    status: "running",
    updatedAt: "2026-11-03T00:00:00Z",
  }),
];

async function setup(
  currentAgents = agents,
  height = 24,
  kittyKeyboard = false,
  env: NodeJS.ProcessEnv = {},
) {
  const agentsPort = new FakeAgents(currentAgents);
  const store = createAgentsStore(agentsPort);
  await store.load();
  const ports = new Map<string, FakeAgent>();
  const connection = new FakeConnection();
  const status = watchConnection(connection, () => void store.resync());
  const test = await createTestRenderer({ width: 120, height, kittyKeyboard });
  renders.push(test.waitForVisualIdle);
  cleanups.push(async () => {
    renders.splice(renders.indexOf(test.waitForVisualIdle), 1);
  });
  const theme = createTheme(env);
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  cleanups.push(async () => {
    await test.dispose();
    syntaxStyle.destroy();
    timelines.close();
    status.close();
    await store.close();
  });
  const timelines = createTimelineRegistry((value) => {
    const port = new FakeAgent(value, [
      { type: "user_message", text: `hello ${value.id}` },
      { type: "assistant_message", text: "Hi " },
      { type: "assistant_message", text: "there" },
    ]);
    ports.set(value.id, port);
    return createTimelineStore(port);
  });
  flushSync(() =>
    root.render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <App
          label="local (127.0.0.1:6767)"
          connection={status}
          agents={store}
          onExit={() => test.renderer.destroy()}
          timelines={timelines}
        />
      </ThemeContext>,
    ),
  );
  const app = {
    stdin: {
      write(input: string) {
        if (input.startsWith("\u001b[200~"))
          void test.mockInput.pasteBracketedText(input.slice(6, -6));
        else test.mockInput.pressKey(input);
      },
    },
    lastFrame: () => test.captureCharFrame(),
  };
  await settle();
  await test.renderOnce();
  return { app, ports, agentsPort, connection, test };
}

describe("App", () => {
  it("keeps q and ? editable and quits with Ctrl-C from the prompt", async () => {
    const { app, ports } = await setup();
    for (const input of ["\r", "i", "q", "?"]) {
      app.stdin.write(input);
      await settle();
    }
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    expect(app.lastFrame()).toContain("q?");
    expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
    expect(port.released).toBe(false);
    app.stdin.write("\u0003");
    await settle();
    expect(port.released).toBe(true);
    expect(port.sent).toEqual([]);
  });

  it("shows cancellation errors and lets the user retry", async () => {
    const { app, ports } = await setup([agent("alpha", { status: "running" })]);
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    port.cancelError = new Error("Stop rejected");
    app.stdin.write("\u0018");
    await settle();
    expect(app.lastFrame()).toContain("Stop rejected");
    port.cancelError = null;
    app.stdin.write("\u0018");
    await settle();
    expect(port.canceled).toBe(2);
    expect(app.lastFrame()).not.toContain("Stop rejected");
    expect(app.lastFrame()).toContain("Stop requested.");
  });
  it.each([12, 24])(
    "keeps permission choices visible with long descriptions at %i rows",
    async (height) => {
      const request: AgentPermissionRequest = {
        id: "long",
        provider: "codex",
        name: "Long permission",
        kind: "tool",
        description: Array.from(
          { length: 12 },
          (_, index) => `Detail ${index}`,
        ).join("\n"),
        input: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
        actions: [
          { id: "yes", behavior: "allow", label: "Allow once" },
          { id: "no", behavior: "deny", label: "Deny once" },
        ],
      };
      const { app } = await setup(
        [agent("alpha", { pendingPermissions: [request] })],
        height,
      );
      app.stdin.write("\r");
      await settle();
      expect(app.lastFrame()).toContain("Long permission");
      expect(app.lastFrame()).toContain("1. Allow once");
      expect(app.lastFrame()).toContain("2. Deny once");
      expect(app.lastFrame()).toContain("1–9 choose · Esc defer");
    },
  );
  it("keeps the cursor visible when editing the beginning of a long prompt", async () => {
    const { app } = await setup();
    for (const input of ["\r", "i", `BEGIN${"x".repeat(200)}`, "\u001b[H"]) {
      app.stdin.write(input);
      await settle();
    }
    expect(app.lastFrame()).toContain("BEGIN");
  });
  it("shows send progress and prevents duplicate submissions before React renders", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    let finish = () => {};
    port.sendGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    app.stdin.write("i");
    await settle();
    app.stdin.write("send once");
    await settle();
    app.stdin.write("\r");
    app.stdin.write("\r");
    await settle();
    expect(port.sent).toEqual(["send once"]);
    expect(app.lastFrame()).toContain("Sending…");
    finish();
    await settle();
    expect(app.lastFrame()).not.toContain("Sending…");
  });
  it("returns to a deferred permission by reopening the same agent", async () => {
    const request: AgentPermissionRequest = {
      id: "deferred",
      provider: "codex",
      name: "Deferred request",
      kind: "tool",
    };
    const { app, ports } = await setup([
      agent("alpha", { pendingPermissions: [request] }),
    ]);
    app.stdin.write("\r");
    await settle();
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).toContain("NORMAL");
    app.stdin.write("\t");
    await settle();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("y");
    await settle();
    expect(ports.get("alpha")?.responses).toEqual([
      { id: "deferred", response: { behavior: "allow" } },
    ]);
  });

  it("shows permission progress and prevents duplicate replies before React renders", async () => {
    const request: AgentPermissionRequest = {
      id: "pending",
      provider: "codex",
      name: "Wait permission",
      kind: "tool",
    };
    const { app, ports } = await setup([
      agent("alpha", { pendingPermissions: [request] }),
    ]);
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    let finish = () => {};
    port.responseGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    app.stdin.write("y");
    app.stdin.write("y");
    await settle();
    expect(port.responses).toEqual([
      { id: "pending", response: { behavior: "allow" } },
    ]);
    expect(app.lastFrame()).toContain("Responding…");
    finish();
    await settle();
    expect(app.lastFrame()).not.toContain("Wait permission");
  });

  it("shows stop progress and prevents duplicate cancellation before React renders", async () => {
    const { app, ports } = await setup([agent("alpha", { status: "running" })]);
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    let finish = () => {};
    port.cancelGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    app.stdin.write("\u0018");
    app.stdin.write("\u0018");
    await settle();
    expect(port.canceled).toBe(1);
    expect(app.lastFrame()).toContain("Stopping…");
    finish();
    await settle();
    expect(app.lastFrame()).toContain("Stop requested.");
  });
  it.each(["idle", "running"] as const)(
    "Ctrl-X only cancels a running turn (%s)",
    async (status) => {
      const { app, ports } = await setup([agent("alpha", { status })]);
      app.stdin.write("\r");
      await settle();
      app.stdin.write("\u0018");
      await settle();
      expect(ports.get("alpha")?.canceled).toBe(status === "running" ? 1 : 0);
    },
  );

  it("toggles help without moving the list or dispatching pane keys", async () => {
    const { app, ports } = await setup();
    app.stdin.write("?");
    await settle();
    expect(app.lastFrame()).toContain("Keyboard shortcuts");
    expect(app.lastFrame()).toContain("Ctrl-X");
    app.stdin.write("j");
    app.stdin.write("\r");
    await settle();
    expect([...ports.keys()]).toEqual([]);
    app.stdin.write("?");
    await settle();
    expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
    app.stdin.write("\r");
    await settle();
    expect([...ports.keys()]).toEqual(["alpha"]);
  });

  it.each([
    { key: "y", behavior: "allow" },
    { key: "n", behavior: "deny" },
  ] as const)(
    "responds $behavior without actions",
    async ({ key, behavior }) => {
      const request: AgentPermissionRequest = {
        id: "plain",
        provider: "codex",
        name: "Edit file",
        kind: "tool",
      };
      const { app, ports } = await setup([
        agent("alpha", { pendingPermissions: [request] }),
      ]);
      app.stdin.write("\r");
      await settle();
      expect(app.lastFrame()).toContain("Edit file");
      app.stdin.write(key);
      await settle();
      expect(ports.get("alpha")?.responses).toEqual([
        { id: "plain", response: { behavior } },
      ]);
      expect(app.lastFrame()).not.toContain("Edit file");
    },
  );

  it("shows the app hint for questions, ignores y, defers with Esc, and still permits denial", async () => {
    const request: AgentPermissionRequest = {
      id: "question",
      provider: "codex",
      name: "Which file?",
      kind: "question",
    };
    const { app, ports } = await setup([
      agent("alpha", { pendingPermissions: [request] }),
    ]);
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("answer in the app");
    app.stdin.write("y");
    await settle();
    expect(ports.get("alpha")?.responses).toEqual([]);
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).toContain("NORMAL");
    expect(app.lastFrame()).toContain("Which file?");
    expect(ports.get("alpha")?.responses).toEqual([]);
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    port.requestPermission({ ...request, id: "new-question" });
    await settle();
    app.stdin.write("n");
    await settle();
    expect(port.responses).toEqual([
      { id: "new-question", response: { behavior: "deny" } },
    ]);
  });
  it("edits at the cursor and preserves multiline bracketed paste and shortcut text", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("i");
    await settle();
    for (const input of [
      "ac",
      "\u001b[D",
      "b",
      "\u001b[C",
      "\u007f",
      "\u001b[200~q?\nsecond line\u001b[201~",
    ]) {
      app.stdin.write(input);
      await settle();
    }
    app.stdin.write("\r");
    await settle();
    expect(ports.get("alpha")?.sent).toEqual(["abq?\nsecond line"]);
    expect(app.lastFrame()).not.toContain("Keyboard shortcuts");
  });

  it("keeps a failed prompt editable and the error visible until a successful retry", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    port.sendError = new Error("Send rejected");
    app.stdin.write("i");
    await settle();
    app.stdin.write("retry this");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("Send rejected");
    expect(app.lastFrame()).toContain("retry this");
    port.sendError = null;
    app.stdin.write("\r");
    await settle();
    expect(port.sent).toEqual(["retry this", "retry this"]);
    expect(app.lastFrame()).not.toContain("Send rejected");
    expect(app.lastFrame()).not.toContain("retry this");
  });

  it("keeps a failed permission available for retry and displays its error", async () => {
    const request: AgentPermissionRequest = {
      id: "retry",
      provider: "codex",
      name: "Retry permission",
      kind: "tool",
    };
    const { app, ports } = await setup([
      agent("alpha", { pendingPermissions: [request] }),
    ]);
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    port.responseError = new Error("Response rejected");
    app.stdin.write("y");
    await settle();
    expect(app.lastFrame()).toContain("Response rejected");
    expect(app.lastFrame()).toContain("Retry permission");
    port.responseError = null;
    app.stdin.write("n");
    await settle();
    expect(port.responses).toEqual([
      { id: "retry", response: { behavior: "allow" } },
      { id: "retry", response: { behavior: "deny" } },
    ]);
    expect(app.lastFrame()).not.toContain("Response rejected");
    expect(app.lastFrame()).not.toContain("Retry permission");
  });
  it("focuses a new permission and sends the second numbered action", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    app.stdin.write("i");
    await settle();
    port.requestPermission({
      id: "permission",
      provider: "codex",
      name: "shell",
      title: "Run command?",
      description: "Writes a file",
      kind: "tool",
      input: { command: "touch x.txt" },
      actions: [
        { id: "once", label: "Allow once", behavior: "allow" },
        { id: "reject", label: "Reject", behavior: "deny" },
      ],
    });
    await settle();
    expect(app.lastFrame()).toContain("Run command?");
    expect(app.lastFrame()).toContain("Writes a file");
    expect(app.lastFrame()).toContain("tool");
    expect(app.lastFrame()).toContain("touch x.txt");
    app.stdin.write("2");
    await settle();
    expect(port.responses).toEqual([
      {
        id: "permission",
        response: { behavior: "deny", selectedActionId: "reject" },
      },
    ]);
    expect(app.lastFrame()).not.toContain("Run command?");
  });
  it("opens the prompt, sends typed text once, ignores empty input, and cancels with Esc", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    app.stdin.write("i");
    await settle();
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");
    expect(port.sent).toEqual([]);
    app.stdin.write("say done");
    await settle();
    app.stdin.write("\r");
    await settle();
    expect(port.sent).toEqual(["say done"]);
    app.stdin.write("i");
    await settle();
    app.stdin.write("discard me");
    await settle();
    app.stdin.write("\u001b");
    await settle();
    await expect.poll(() => app.lastFrame()).not.toContain("discard me");
    expect(port.sent).toEqual(["say done"]);
  });
  it("groups agents by workspace and opens the second agent with j then Enter", async () => {
    const { app, ports } = await setup();
    const list = app.lastFrame() ?? "";
    expect(list).toContain("/repo/one");
    expect(list).toContain("/repo/two");
    expect(list.indexOf("/repo/one")).toBeLessThan(list.indexOf("Alpha agent"));
    expect(list.indexOf("Beta agent")).toBeLessThan(list.indexOf("/repo/two"));
    expect(list).toContain("local (127.0.0.1:6767) connected");

    app.stdin.write("j");
    await settle();
    app.stdin.write("\r");
    await settle();

    expect([...ports.keys()]).toEqual(["beta"]);
    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("› hello beta");
    await expect
      .poll(async () => {
        await settle();
        return app.lastFrame();
      })
      .toContain("Hi there");
    expect(frame).toContain("turn idle");
  });

  it("re-renders when a live event arrives and closes the timeline on q", async () => {
    const { app, ports } = await setup();
    app.stdin.write("\r");
    await settle();
    const port = ports.get("alpha");
    if (!port) throw new Error("alpha timeline was not opened");

    port.pushAssistant(4, "live reply");
    await settle();
    await expect
      .poll(async () => {
        await settle();
        return app.lastFrame();
      })
      .toContain("live reply");

    app.stdin.write("q");
    await settle();
    expect(port.released).toBe(true);
  });

  it("shows reconnecting and resyncs the agent list when the connection returns", async () => {
    const { app, agentsPort, connection } = await setup();
    expect(agentsPort.lists).toBe(1);

    connection.emit({ status: "disconnected", reason: "socket closed" });
    await settle();
    expect(app.lastFrame()).toContain("127.0.0.1:6767) reconnecting");

    connection.emit({ status: "connecting", attempt: 2 });
    await settle();
    expect(app.lastFrame()).toContain("reconnecting (attempt 2)");
    expect(agentsPort.lists).toBe(1);

    connection.emit({ status: "connected" });
    await settle();
    expect(app.lastFrame()).toContain("local (127.0.0.1:6767) connected");
    expect(agentsPort.lists).toBe(2);
  });
});

it("disables mouse through rendererOptions", () => {
  expect(rendererOptions({ mouse: false }).useMouse).toBe(false);
});
it("opens the selected agent by clicking its row", async () => {
  const { test, ports } = await setup();
  await test.mockMouse.click(4, 1);
  await settle();
  expect(ports.has("alpha")).toBe(true);
});
it("renders markdown and expands shell output with o", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  const port = ports.get("alpha");
  if (!port) throw new Error("missing port");
  port.pushAssistant(4, "\n# Heading\n\n**bold**");
  await settle();
  expect(app.lastFrame()).toContain("Heading");
  expect(app.lastFrame()).not.toContain("**bold**");
  port.handler?.({
    agentId: "alpha",
    epoch: "epoch",
    seq: 5,
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
  expect(app.lastFrame()).not.toContain("secret output");
  app.stdin.write("}");
  await settle();
  app.stdin.write("o");
  await settle();
  expect(app.lastFrame()).toContain("secret output");
  app.stdin.write("?");
  await settle();
  expect(app.lastFrame()).toContain("Keyboard shortcuts");
  app.stdin.write("?");
  await settle();
  expect(app.lastFrame()).toContain("secret output");
});

it("toggles the sidebar while retaining the open timeline", async () => {
  const { app } = await setup();
  app.stdin.write("\r");
  await settle();
  app.stdin.write("\\");
  await settle();
  expect(app.lastFrame()).not.toContain("/repo/two");
  expect(app.lastFrame()).toContain("hello alpha");
  app.stdin.write("\\");
  await settle();
  expect(app.lastFrame()).toContain("/repo/two");
});

it("inserts newlines with Shift-Enter and Ctrl-J before submitting", async () => {
  const { app, test, ports } = await setup(agents, 24, true);
  app.stdin.write("\r");
  await settle();
  app.stdin.write("i");
  await settle();
  await test.mockInput.typeText("one");
  test.mockInput.pressEnter({ shift: true });
  await settle();
  await test.mockInput.typeText("two");
  test.mockInput.pressKey("j", { ctrl: true });
  await settle();
  await test.mockInput.typeText("three");
  expect(ports.get("alpha")?.sent).toEqual([]);
  test.mockInput.pressEnter();
  await settle();
  expect(ports.get("alpha")?.sent).toEqual(["one\ntwo\nthree"]);
});

it("uses terminal foreground colors throughout the shell with NO_COLOR", async () => {
  const { test } = await setup(agents, 24, false, { NO_COLOR: "1" });
  const colors = new Set(
    test
      .captureSpans()
      .lines.flatMap((line) =>
        line.spans
          .filter((span) => span.text.trim())
          .map((span) => span.fg.toString()),
      ),
  );
  expect(colors.size).toBe(1);
});

it("keeps the selected agent visible when navigating beyond the sidebar viewport", async () => {
  const many = Array.from({ length: 40 }, (_, index) =>
    agent(`agent-${index}`, {
      title: `Agent ${index.toString().padStart(2, "0")}`,
      cwd: "/repo/one",
      workspaceId: "one",
      updatedAt: new Date(
        Date.UTC(2026, 10, 4, 0, 0, 40 - index),
      ).toISOString(),
    }),
  );
  const { app } = await setup(many);
  app.stdin.write("G");
  await settle();
  expect(app.lastFrame()).toContain("Agent 39");
  app.stdin.write("g");
  await settle();
  app.stdin.write("g");
  await settle();
  expect(app.lastFrame()).toContain("Agent 00");
});

it("splits, shares stream rows, assigns independently and focuses by click", async () => {
  const { app, ports, test } = await setup();
  for (const key of ["\r", "\u0002", "%"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame().split("hello alpha").length - 1).toBe(2);
  ports.get("alpha")?.pushAssistant(4, "shared stream");
  await settle();
  await expect
    .poll(async () => {
      await settle();
      return app.lastFrame().split("shared stream").length - 1;
    })
    .toBe(2);
  for (const key of ["\t", "j", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("hello alpha");
  expect(app.lastFrame()).toContain("hello beta");
  await test.mockMouse.click(40, 1);
  await settle();
  app.stdin.write("i");
  await settle();
  app.stdin.write("first pane");
  await settle();
  app.stdin.write("\r");
  await settle();
  expect(ports.get("alpha")?.sent).toEqual(["first pane"]);
  expect(ports.get("beta")?.sent).toEqual([]);
});
it("search commits select and scroll to a matching block", async () => {
  const { app, ports } = await setup();
  app.stdin.write("\r");
  await settle();
  ports
    .get("alpha")
    ?.pushAssistant(
      4,
      `\n${Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n")}`,
    );
  await settle();
  expect(app.lastFrame()).not.toContain("hello alpha");
  for (const key of ["/", "hello", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(app.lastFrame()).toContain("▌");
  expect(app.lastFrame()).toContain("match 1/1");
  expect(app.lastFrame()).toContain("hello alpha");
});
it("prefix preserves insert text, repeats literally, and expires after 1500ms", async () => {
  const { app, ports } = await setup();
  for (const key of ["\r", "i", "before", "\u0002", "\u0002", "after", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  expect(ports.get("alpha")?.sent).toEqual(["before\u0002after"]);
  app.stdin.write("\u0002");
  await settle();
  expect(app.lastFrame()).toContain("PREFIX");
  await new Promise((resolve) => setTimeout(resolve, 1550));
  await settle();
  expect(app.lastFrame()).toContain("NORMAL");
});

it("pane header includes provider and model", async () => {
  const { app } = await setup([agent("alpha", { model: "gpt-6" })]);
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("codex/gpt-6");
});

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
