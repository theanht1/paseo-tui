import { expect, it } from "vitest";
import { settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

async function typing(extra: Parameters<typeof setup>[8] = {}) {
  const result = await setup(
    [agent("alpha", { status: "running", title: "Alpha agent" })],
    30,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    extra,
  );
  for (const key of ["\r", "i"]) {
    result.app.stdin.write(key);
    await settle();
  }
  const port = result.ports.get("alpha");
  if (!port) throw Error("alpha timeline was not opened");
  async function queue(text: string) {
    result.app.stdin.write(text);
    await settle();
    result.app.stdin.write("\r");
    await settle();
  }
  return { ...result, port, queue };
}

it("queues Enter while the agent works and sends it when the turn ends", async () => {
  const { app, port, queue } = await typing();
  await queue("next step");
  expect(port.sent).toEqual([]);
  expect(app.lastFrame()).toContain("⧗ 1. next step");
  expect(app.lastFrame()).toContain("INSERT");
  port.endTurn({ type: "turn_completed" });
  await settle();
  expect(port.sent).toEqual(["next step"]);
  expect(app.lastFrame()).not.toContain("⧗ 1.");
});

it("moves a queued message into the prompt with Ctrl-R, after the draft", async () => {
  const { app, port, queue } = await typing();
  await queue("queued one");
  app.stdin.write("draft");
  await settle();
  app.stdin.write("\u0012");
  await settle();
  expect(app.lastFrame()).not.toContain("⧗ 1.");
  expect(app.lastFrame()).toContain("draft");
  expect(app.lastFrame()).toContain("queued one");
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).toContain("⧗ 1. draft …");
  expect(port.sent).toEqual([]);
});

it("sends the selected queued message now with Ctrl-S and removes one with Ctrl-O", async () => {
  const { app, port, queue, test } = await typing();
  await queue("first");
  await queue("second");
  await queue("third");
  test.mockInput.pressArrow("down", { ctrl: true });
  test.mockInput.pressArrow("down", { ctrl: true });
  await settle();
  app.stdin.write("\u0013");
  await settle();
  expect(port.steered).toEqual(["second"]);
  app.stdin.write("\u000f");
  await settle();
  expect(app.lastFrame()).not.toContain("first");
  expect(app.lastFrame()).toContain("⧗ 1. third");
  expect(port.sent).toEqual([]);
});

it("pauses the queue after a stop and resumes with Enter on an empty prompt", async () => {
  const { app, port, queue } = await typing();
  await queue("after the stop");
  app.stdin.write("\u0018");
  await settle();
  port.endTurn();
  await settle();
  expect(port.sent).toEqual([]);
  expect(app.lastFrame()).toContain("Queue paused · Enter to resume");
  app.stdin.write("\r");
  await settle();
  expect(port.sent).toEqual(["after the stop"]);
});

it("warns before quitting with queued messages, and clears them from the Command Center", async () => {
  let exits = 0;
  const { app, queue } = await typing({ onExit: () => exits++ });
  await queue("unsent");
  for (const key of ["\u001b", "\u0003"]) {
    app.stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  }
  expect(app.lastFrame()).toContain("1 queued message will be lost");
  for (const key of ["\u000b", "clear message queue"]) {
    app.stdin.write(key);
    await settle();
  }
  app.stdin.write("\r");
  await settle();
  expect(app.lastFrame()).not.toContain("⧗ 1.");
  expect(exits).toBe(0);
});

it("asks for a second Ctrl-O before removing a multi-line message", async () => {
  const { app, queue } = await typing();
  app.stdin.write("line one");
  await settle();
  app.stdin.write("\n");
  await settle();
  await queue("line two");
  expect(app.lastFrame()).toContain("⧗ 1. line one …");
  app.stdin.write("\u000f");
  await settle();
  expect(app.lastFrame()).toContain(
    "Ctrl-O again removes this multi-line message",
  );
  expect(app.lastFrame()).toContain("⧗ 1. line one …");
  app.stdin.write("\u000f");
  await settle();
  expect(app.lastFrame()).not.toContain("⧗ 1.");
});
