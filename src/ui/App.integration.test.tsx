import type { PaseoAgentTimelineEvent } from "@getpaseo/client";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { afterEach, expect, inject, it } from "vitest";
import { connect } from "../connection/connect.js";
import { createSession } from "../session.js";
import { App } from "./App.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "./render/theme.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  const session = createSession(connection);
  await session.agents.load();
  const renderer = await createTestRenderer({ width: 120, height: 40 });
  const theme = createTheme({});
  const syntaxStyle = createSyntaxStyle(renderer.renderer, theme);
  const root = createRoot(renderer.renderer);
  const ids = new Set<string>();
  const stopUpdates = session.agentsPort.onUpdate((update) => {
    if (update.kind === "upsert") ids.add(update.agent.id);
  });
  cleanups.push(async () => {
    stopUpdates();
    await renderer.dispose();
    syntaxStyle.destroy();
    for (const id of ids) {
      const agent = await connection.api.agents.ref(id).refresh();
      if (agent && !agent.agent.archivedAt)
        await connection.api.agents.ref(id).archive();
    }
    await session.close();
    await connection.close();
  });
  flushSync(() =>
    root.render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <App
          label={connection.label}
          connection={session.status}
          agents={session.agents}
          directory={session.directory}
          terminals={session.terminals}
          management={session.management}
          refresh={session.refresh}
          timelines={session.timelines}
          catalog={session.agentsPort}
          onExit={() => renderer.renderer.destroy()}
        />
      </ThemeContext>,
    ),
  );
  async function frame() {
    await renderer.renderOnce();
    return renderer.captureCharFrame();
  }
  async function key(value: string) {
    renderer.mockInput.pressKey(value);
    await renderer.waitForVisualIdle();
  }
  async function waitFor(text: string) {
    await expect.poll(frame, { timeout: 15000, interval: 50 }).toContain(text);
  }
  async function waitForBreadcrumb(breadcrumb: string) {
    await expect
      .poll(
        async () => {
          const line = (await frame())
            .split("\n")
            .find((value) => value.includes("Command Center"));
          if (!line) return false;
          const start = line.indexOf("Command Center");
          const header = (line.slice(start).split("│")[0] ?? "").trim();
          return header === breadcrumb;
        },
        { timeout: 15000, interval: 50 },
      )
      .toBe(true);
  }
  async function waitForChoice(id: string) {
    await expect
      .poll(() => renderer.renderer.root.findDescendantById(`command:${id}`), {
        timeout: 15000,
        interval: 50,
      })
      .toBeDefined();
  }
  async function type(text: string) {
    await renderer.mockInput.typeText(text);
    await renderer.waitForVisualIdle();
  }
  async function openAgent(title: string) {
    await key("\r");
    await waitFor(`Message ${title}`);
    await waitFor("turn idle");
  }
  async function sendPrompt(text: string) {
    await key("i");
    await waitFor("INSERT");
    await type(text);
    await waitFor(text);
    await key("\r");
    await waitFor("NORMAL");
  }
  async function create(
    title: string,
    featureValues?: Record<string, unknown>,
  ) {
    const handle = await connection.api.agents.create({
      cwd: process.cwd(),
      title,
      config: {
        provider: "mock/ten-second-stream",
        ...(featureValues ? { featureValues } : {}),
      },
    });
    ids.add(handle.id);
    await waitFor(title);
    return handle;
  }
  return {
    connection,
    session,
    renderer,
    frame,
    key,
    type,
    waitFor,
    waitForBreadcrumb,
    waitForChoice,
    create,
    openAgent,
    sendPrompt,
  };
}

it("shows an external agent, sends prompts and handles plan, question and failure", async () => {
  const app = await setup();
  const handle = await app.create("UI prompts");
  const events: PaseoAgentTimelineEvent[] = [];
  const unsubscribe = handle.timeline.subscribe((event) => events.push(event));
  await unsubscribe.ready;
  await app.openAgent("UI prompts");
  await app.sendPrompt("emit synthetic plan approval");
  await app.waitFor("Review the proposed plan");
  await app.key("1");
  await expect
    .poll(
      () =>
        events.some(
          (event) =>
            event.event.type === "permission_resolved" &&
            event.event.resolution.behavior === "allow" &&
            event.event.resolution.selectedActionId === "implement",
        ),
      { timeout: 10000, interval: 50 },
    )
    .toBe(true);
  await expect
    .poll(app.frame, { timeout: 10000, interval: 50 })
    .not.toContain("Review the proposed plan");
  await app.waitFor("turn idle");
  await app.sendPrompt("emit synthetic question");
  await app.waitFor("answer in the app");
  await app.key("n");
  await expect
    .poll(
      () =>
        events.some(
          (event) =>
            event.event.type === "permission_resolved" &&
            event.event.resolution.behavior === "deny",
        ),
      { timeout: 10000, interval: 50 },
    )
    .toBe(true);
  await expect
    .poll(app.frame, { timeout: 10000, interval: 50 })
    .not.toContain("answer in the app");
  await app.waitFor("turn idle");
  await app.sendPrompt("emit synthetic turn failure");
  await app.waitFor("Requested mock provider failure");
  unsubscribe();
}, 45000);

it("renders a streaming response and stops the running turn", async () => {
  const app = await setup();
  const handle = await app.create("UI streaming", {
    mockStreamingAssistantResponse: "Streaming markdown **hello** ".repeat(80),
    mockStreamingAssistantIntervalMs: 80,
  });
  await app.openAgent("UI streaming");
  await app.sendPrompt("stream please");
  await app.waitFor("Streaming markdown");
  await app.key("\u0018");
  await expect
    .poll(async () => (await handle.refresh())?.agent.status, {
      timeout: 10000,
      interval: 50,
    })
    .not.toBe("running");
}, 25000);

it("renders the default mock turn's edit and shell tools", async () => {
  const app = await setup();
  const handle = await app.connection.api.agents.create({
    cwd: process.cwd(),
    title: "UI tools",
    config: { provider: "mock/ten-second-stream" },
  });
  await app.waitFor("UI tools");
  await app.openAgent("UI tools");
  await app.sendPrompt("show tools");
  const agent = handle.current();
  if (!agent) throw new Error("missing agent");
  const timeline = app.session.timelines.acquire(agent);
  await expect
    .poll(
      () =>
        timeline.store
          .getSnapshot()
          .rows.some(
            (row) =>
              row.item.type === "tool_call" &&
              row.item.name === "bash" &&
              row.item.status === "completed",
          ),
      { timeout: 20000, interval: 50 },
    )
    .toBe(true);
  await app.key("/");
  await app.type("NEAR_BOTTOM_PX");
  await app.key("\r");
  await app.waitFor("NEAR_BOTTOM_PX");
  await app.key("/");
  await app.type("simulate-stream-burst.mjs");
  await app.key("\r");
  await app.waitFor("▌✓ bash");
  await app.waitFor("userIsAtBottom=true");
  timeline.release();
  await handle.archive();
}, 45000);

it("reports a connection error for an unavailable host", async () => {
  await expect(
    connect({ kind: "host", connection: "127.0.0.1:1" }),
  ).rejects.toThrow("Cannot connect to Paseo");
});

it("creates and manages a mock agent through Command Center", async () => {
  const app = await setup();
  await app.create("Workspace seed");
  await app.openAgent("Workspace seed");
  await app.key(":");
  await app.waitForBreadcrumb("Command Center");
  await app.type("new agent");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Provider");
  await app.type("mock");
  await app.waitForChoice("provider:mock");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Provider › Model");
  await app.type("Ten second stream");
  await app.waitForChoice("model:ten-second-stream");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Provider › Model › Mode");
  await app.waitForChoice("mode:load-test");
  await app.key("\r");
  await app.waitForBreadcrumb(
    "Command Center › Provider › Model › Mode › Title",
  );
  await app.type("Created from UI");
  await app.key("\r");
  await app.waitForBreadcrumb(
    "Command Center › Provider › Model › Mode › Title › First prompt",
  );
  await app.key("\r");
  await app.waitFor("Message Created from UI");
  await expect
    .poll(
      () =>
        app.session.agents
          .getSnapshot()
          .groups.flatMap((group) => group.agents)
          .find((agent) => agent.title === "Created from UI")?.model,
      { timeout: 10000, interval: 50 },
    )
    .toBe("ten-second-stream");
  await app.waitFor("NORMAL");
  await app.key(":");
  await app.waitForBreadcrumb("Command Center");
  await app.type("set mode");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Set mode");
  await app.type("Approval Test");
  await app.waitForChoice("mode:approval-test");
  await app.key("\r");
  await expect
    .poll(
      () =>
        app.session.agents
          .getSnapshot()
          .groups.flatMap((group) => group.agents)
          .find((agent) => agent.title === "Created from UI")?.currentModeId,
      { timeout: 10000, interval: 50 },
    )
    .toBe("approval-test");
  await app.key(":");
  await app.waitForBreadcrumb("Command Center");
  await app.type("set model");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Set model");
  await app.type("Thirty minute stream");
  await app.waitForChoice("model:thirty-minute-stream");
  await app.key("\r");
  await expect
    .poll(
      () =>
        app.session.agents
          .getSnapshot()
          .groups.flatMap((group) => group.agents)
          .find((agent) => agent.title === "Created from UI")?.model,
      { timeout: 10000, interval: 50 },
    )
    .toBe("thirty-minute-stream");
  await app.key(":");
  await app.waitForBreadcrumb("Command Center");
  await app.type("rename");
  await app.key("\r");
  await app.waitForBreadcrumb("Command Center › Rename");
  await app.key("\u0015");
  await app.type("Renamed from UI");
  await app.key("\r");
  await app.waitFor("Renamed from UI");
  // Archiving an agent is closing its tab (Z Q); the Command Center archives workspaces.
  await app.key("Z");
  await app.key("Q");
  await app.waitFor("Archive agent “Renamed from UI”?");
  await app.key("y");
  await expect
    .poll(
      () =>
        app.session.agents
          .getSnapshot()
          .groups.flatMap((group) => group.agents)
          .some((agent) => agent.title === "Renamed from UI"),
      { timeout: 10000, interval: 50 },
    )
    .toBe(false);
}, 45000);
