import { expect, it } from "vitest";
import { settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

async function running() {
  const result = await setup([agent("alpha", { status: "running" })]);
  result.app.stdin.write("\r");
  await settle();
  const port = result.ports.get("alpha");
  if (!port) throw Error("alpha timeline was not opened");
  return { ...result, port };
}

it("stops from the prompt with Ctrl-X, keeping the draft and insert mode", async () => {
  const { app, port } = await running();
  let finish = () => {};
  port.cancelGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  for (const key of ["i", "half a thought"]) {
    app.stdin.write(key);
    await settle();
  }
  app.stdin.write("\u0018");
  await settle();
  expect(port.canceled).toBe(1);
  expect(app.lastFrame()).toContain("Stopping…");
  expect(app.lastFrame()).toContain("stopping");
  expect(app.lastFrame()).toContain("half a thought");
  expect(app.lastFrame()).toContain("INSERT");
  finish();
  await settle();
  expect(app.lastFrame()).toContain("Stop requested.");
  port.endTurn();
  await settle();
  expect(app.lastFrame()).not.toContain("Stop requested.");
  expect(app.lastFrame()).toContain("half a thought");
  expect(port.sent).toEqual([]);
});
