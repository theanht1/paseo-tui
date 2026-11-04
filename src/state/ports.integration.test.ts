import type {
  PaseoAgentTimelineEvent,
  PaseoAgentUpdate,
} from "@getpaseo/client";
import { afterEach, beforeEach, expect, inject, it } from "vitest";
import { type Connection, connect } from "../connection/connect.js";
import { createAgentPort } from "./ports.js";
import { createSession } from "./session.js";

let connection: Connection;
let session: ReturnType<typeof createSession>;
const created: string[] = [];

beforeEach(async () => {
  connection = await connect({
    kind: "host",
    connection: inject("daemonHost"),
  });
  session = createSession(connection);
  await session.agents.load();
});
afterEach(async () => {
  for (const id of created.splice(0))
    await connection.api.agents.ref(id).archive();
  await session.close();
  await connection.close();
});

it("lists the mock catalogs and observes agent lifecycle and streaming pages", async () => {
  expect(
    (await session.agentsPort.providers()).find((p) => p.id === "mock")
      ?.available,
  ).toBe(true);
  expect(
    (await session.agentsPort.models("mock")).some(
      (m) => m.id === "ten-second-stream",
    ),
  ).toBe(true);
  expect(
    (await session.agentsPort.modes("mock")).some((m) => m.id === "load-test"),
  ).toBe(true);
  const updates: PaseoAgentUpdate[] = [];
  const stopUpdates = session.agentsPort.onUpdate((update) =>
    updates.push(update),
  );
  const agent = await session.agentsPort.create({
    provider: "mock",
    model: "ten-second-stream",
    modeId: null,
    cwd: process.cwd(),
    title: "Port lifecycle",
    prompt: null,
  });
  created.push(agent.id);
  const list = await session.agentsPort.list();
  expect(list.entries.some((entry) => entry.agent.id === agent.id)).toBe(true);
  await list.subscription.release();
  const port = createAgentPort(
    connection.api.agents.ref(agent),
    connection.daemon,
  );
  const events: PaseoAgentTimelineEvent[] = [];
  const unsubscribe = port.subscribe((event) => events.push(event));
  await unsubscribe.ready;
  await port.send("emit synthetic plan approval");
  await expect
    .poll(
      () =>
        updates.some(
          (u) =>
            u.kind === "upsert" &&
            u.agent.id === agent.id &&
            u.agent.status === "running",
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(() => events.find((e) => e.event.type === "permission_requested"), {
      timeout: 10000,
    })
    .toBeDefined();
  const permission = events.find(
    (e) => e.event.type === "permission_requested",
  );
  if (permission?.event.type !== "permission_requested")
    throw new Error("missing permission");
  const requestId = permission.event.request.id;
  const tail = await port.fetchTail(1);
  expect(tail.error).toBeNull();
  expect(tail.endCursor).not.toBeNull();
  if (!tail.endCursor) throw new Error("missing cursor");
  const beforeResolution = updates.length;
  await port.respondToPermission(permission.event.request.id, {
    behavior: "allow",
    selectedActionId: "implement",
  });
  await expect
    .poll(
      () =>
        updates
          .slice(beforeResolution)
          .some(
            (u) =>
              u.kind === "upsert" &&
              u.agent.id === agent.id &&
              u.agent.status === "idle",
          ),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        events.some(
          (event) =>
            event.event.type === "permission_resolved" &&
            event.event.requestId === requestId &&
            event.event.resolution.behavior === "allow" &&
            event.event.resolution.selectedActionId === "implement",
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await expect
    .poll(() => events.some((event) => event.event.type === "turn_completed"), {
      timeout: 10000,
    })
    .toBe(true);
  await port.send("emit synthetic turn failure");
  const cursor = tail.endCursor;
  await expect
    .poll(
      async () => {
        const page = await port.fetchAfter(cursor, 100);
        expect(page.error).toBeNull();
        return page.entries.some(
          (entry) =>
            entry.item.type === "user_message" &&
            entry.item.text === "emit synthetic turn failure",
        );
      },
      { timeout: 10000 },
    )
    .toBe(true);
  unsubscribe();
  stopUpdates();
}, 20000);

it("sets mode and model, renames and archives an agent", async () => {
  const agent = await session.agentsPort.create({
    provider: "mock",
    model: "ten-second-stream",
    modeId: null,
    cwd: process.cwd(),
    title: "Before rename",
    prompt: null,
  });
  created.push(agent.id);
  const port = createAgentPort(
    connection.api.agents.ref(agent),
    connection.daemon,
  );
  await port.setMode("approval-test");
  await port.setModel("ten-second-stream");
  await port.rename("After rename");
  await expect
    .poll(
      async () =>
        (await connection.api.agents.ref(agent.id).refresh())?.agent.title,
      { timeout: 10000 },
    )
    .toBe("After rename");
  const snapshot = (await connection.api.agents.ref(agent.id).refresh())?.agent;
  expect(snapshot?.currentModeId).toBe("approval-test");
  expect(snapshot?.model).toBe("ten-second-stream");
  await port.archive();
  created.splice(created.indexOf(agent.id), 1);
  await expect
    .poll(
      () =>
        session.agents
          .getSnapshot()
          .groups.flatMap((g) => g.agents)
          .some((a) => a.id === agent.id),
      { timeout: 10000 },
    )
    .toBe(false);
}, 20000);

it("cancels a streaming response while its turn is running", async () => {
  const handle = await connection.api.agents.create({
    cwd: process.cwd(),
    config: {
      provider: "mock/ten-second-stream",
      featureValues: {
        mockStreamingAssistantResponse: "A long response ".repeat(100),
        mockStreamingAssistantIntervalMs: 100,
      },
    },
  });
  created.push(handle.id);
  const current = handle.current();
  if (!current) throw new Error("missing agent");
  const port = createAgentPort(
    connection.api.agents.ref(current),
    connection.daemon,
  );
  const events: PaseoAgentTimelineEvent[] = [];
  const stop = port.subscribe((event) => events.push(event));
  await stop.ready;
  await port.send("start streaming");
  await expect
    .poll(
      () =>
        events.some(
          (e) =>
            e.event.type === "timeline" &&
            e.event.item.type === "assistant_message",
        ),
      { timeout: 10000 },
    )
    .toBe(true);
  await port.cancel();
  await expect
    .poll(() => events.some((e) => e.event.type === "turn_canceled"), {
      timeout: 10000,
    })
    .toBe(true);
  stop();
}, 20000);
