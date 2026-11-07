import { describe, expect, it } from "vitest";
import type { CommandListSource, SlashCommand } from "../connection/ports.js";
import { settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";

function completions(names: string[]) {
  return {
    async commands(): Promise<SlashCommand[]> {
      return names.map((name) => ({
        name,
        description: "",
        argumentHint: "",
        kind: "command" as const,
      }));
    },
    async files() {
      return [];
    },
  };
}
async function open(
  names: string[],
  overrides: Parameters<typeof agent>[1] = {},
  port: ReturnType<typeof completions> = completions(names),
) {
  const result = await setup(
    [agent("alpha", { provider: "claude", ...overrides })],
    24,
    false,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    { completions: port },
  );
  result.app.stdin.write("\r");
  await settle();
  const timeline = result.ports.get("alpha");
  if (!timeline) throw Error("alpha timeline was not opened");
  return { ...result, port: timeline };
}
async function press(
  app: Awaited<ReturnType<typeof setup>>["app"],
  ...keys: string[]
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

describe("clear session", () => {
  it("confirms with C, sends /clear and marks the cleared session in the timeline", async () => {
    const { app, port } = await open(["compact", "clear"]);
    await press(app, "C");
    expect(app.lastFrame()).toContain(
      "Clear this session? The conversation is reset.",
    );
    expect(port.sent).toEqual([]);
    await press(app, "y");
    expect(port.sent).toEqual(["/clear"]);
    port.pushAssistant(4, "Claude switched to a new session: old -> new");
    await settle();
    expect(app.lastFrame()).toContain("hello alpha");
    expect(app.lastFrame()).toContain("── session cleared ──");
    expect(app.lastFrame()).not.toContain("old -> new");
  });
  it("cancels without sending", async () => {
    const { app, port } = await open(["clear"]);
    await press(app, "C", "n");
    expect(port.sent).toEqual([]);
    expect(app.lastFrame()).not.toContain("Clear this session?");
  });
  it("is offered in the Command Center as Clear session", async () => {
    const { app, port } = await open(["clear"]);
    await press(app, "\u000b");
    for (const key of "Clear sess") app.stdin.write(key);
    await settle();
    expect(app.lastFrame()).toContain("Clear session");
    await press(app, "\r", "y");
    expect(port.sent).toEqual(["/clear"]);
  });
  it("interrupts a running turn with /clear", async () => {
    const { app, port } = await open(["clear"], { status: "running" });
    await press(app, "C", "y");
    expect(port.interrupted).toEqual(["/clear"]);
    expect(port.sent).toEqual([]);
  });
  it("does nothing when the agent has no clear command", async () => {
    const { app, port } = await open(["compact"]);
    await press(app, "C");
    expect(app.lastFrame()).not.toContain("Clear this session?");
    await press(app, "\u000b");
    for (const key of "Clear sess") app.stdin.write(key);
    await settle();
    expect(app.lastFrame()).not.toContain("Clear session");
    expect(port.sent).toEqual([]);
  });
  it("empties the context meter until the agent reports new usage", async () => {
    const { app } = await open(["clear"], {
      lastUsage: {
        contextWindowUsedTokens: 90_000,
        contextWindowMaxTokens: 200_000,
      },
    });
    expect(app.lastFrame()).toContain("ctx 45%");
    await press(app, "C", "y");
    expect(app.lastFrame()).not.toContain("ctx 45%");
  });
  it("waits for a slow command list instead of refusing", async () => {
    let finish = () => {};
    const slow = completions(["clear"]);
    const list = slow.commands;
    slow.commands = async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return list();
    };
    const { app } = await open(["clear"], {}, slow);
    await press(app, "C");
    expect(app.lastFrame()).not.toContain("no /clear command");
    finish();
    await settle();
    expect(app.lastFrame()).toContain("Clear this session?");
  });
  it("reports a failed command list", async () => {
    const broken = completions(["clear"]);
    broken.commands = async () => {
      throw Error("daemon offline");
    };
    const { app, port } = await open(["clear"], {}, broken);
    await press(app, "C");
    expect(app.lastFrame()).toContain(
      "Could not list commands: daemon offline",
    );
    expect(port.sent).toEqual([]);
  });
  it("asks again when an agent is reopened, so new commands show up", async () => {
    const names: string[] = [];
    const requests: string[] = [];
    const base = completions(names);
    const port = {
      ...base,
      async commands(source: CommandListSource) {
        requests.push(source.kind === "agent" ? source.agentId : "draft");
        return base.commands();
      },
    };
    const result = await setup(
      [
        agent("alpha", {
          provider: "claude",
          updatedAt: "2026-11-03T00:00:02Z",
        }),
        agent("beta", {
          provider: "claude",
          updatedAt: "2026-11-03T00:00:01Z",
        }),
      ],
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { completions: port },
    );
    const { app } = result;
    await press(app, "\r");
    expect(requests).toEqual(["alpha"]);
    await press(app, "g", "t");
    expect(requests).toEqual(["alpha", "beta"]);
    names.push("clear");
    await press(app, "g", "t");
    expect(requests).toEqual(["alpha", "beta", "alpha"]);
    await press(app, "C");
    expect(app.lastFrame()).toContain("Clear this session?");
  });
});
