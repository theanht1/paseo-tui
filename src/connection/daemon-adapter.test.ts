import type { createHostClient } from "@getpaseo/client/node";
import type { AgentProviderNotice } from "@getpaseo/protocol/agent-types";
import { expect, test } from "vitest";
import { createDaemonAdapter } from "./daemon-adapter.js";

type Daemon = Pick<
  ReturnType<typeof createHostClient>,
  "cancelAgent" | "setAgentMode" | "setAgentModel" | "updateAgent"
>;
class FakeDaemon implements Daemon {
  calls: unknown[][] = [];
  notice: AgentProviderNotice | null = null;
  async cancelAgent(id: string) {
    this.calls.push(["cancel", id]);
  }
  async setAgentMode(id: string, mode: string) {
    this.calls.push(["mode", id, mode]);
    return this.notice;
  }
  async setAgentModel(id: string, model: string | null) {
    this.calls.push(["model", id, model]);
  }
  async updateAgent(id: string, updates: { name?: string }) {
    this.calls.push(["rename", id, updates]);
  }
}
test.each(["info", "warning"] as const)(
  "returns %s mode notices",
  async (type) => {
    const fake = new FakeDaemon();
    fake.notice = { type, message: "Mode changed" };
    expect(await createDaemonAdapter(fake).setAgentMode("a", "ask")).toBe(
      "Mode changed",
    );
    expect(fake.calls).toEqual([["mode", "a", "ask"]]);
  },
);
test("rejects error notices and returns null without a notice", async () => {
  const fake = new FakeDaemon();
  const adapter = createDaemonAdapter(fake);
  expect(await adapter.setAgentMode("a", "ask")).toBeNull();
  fake.notice = { type: "error", message: "Unsupported mode" };
  await expect(adapter.setAgentMode("a", "ask")).rejects.toThrow(
    "Unsupported mode",
  );
});
test("forwards ids, trims names and rejects empty names before RPC", async () => {
  const fake = new FakeDaemon();
  const adapter = createDaemonAdapter(fake);
  await adapter.cancelAgent("a");
  await adapter.setAgentModel("b", "model");
  await adapter.renameAgent("c", "  New name  ");
  await expect(adapter.renameAgent("d", " \t ")).rejects.toThrow(
    "Name can't be empty",
  );
  expect(fake.calls).toEqual([
    ["cancel", "a"],
    ["model", "b", "model"],
    ["rename", "c", { name: "New name" }],
  ]);
});
