import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { agents, settle, setup } from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

describe("Ctrl-C in text inputs", () => {
  const quitNotice = "Press Ctrl+C again to quit";
  async function press(
    app: { stdin: { write(input: string): void } },
    ...keys: string[]
  ) {
    for (const key of keys) {
      app.stdin.write(key);
      await settle();
    }
  }
  it("cancels the timeline search instead of arming quit", async () => {
    const { app } = await setup();
    await press(app, "\r", "/", "h", "e");
    expect(app.lastFrame()).toContain("/he");
    await press(app, "\u0003");
    expect(app.lastFrame()).not.toContain(quitNotice);
    expect(app.lastFrame()).toContain("NORMAL");
  });
  it("closes the Command Center query", async () => {
    const { app } = await setup();
    await press(app, "\r", ":", "x");
    expect(app.lastFrame()).toContain("Command Center");
    await press(app, "\u0003");
    expect(app.lastFrame()).not.toContain("Command Center");
    expect(app.lastFrame()).not.toContain(quitNotice);
    expect(app.lastFrame()).toContain("NORMAL");
  });
  it("closes the rename and new-workspace prompts", async () => {
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
      archiveWorkspace: async () => {},
    };
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      management,
    );
    await press(app, "\r", "R");
    expect(app.lastFrame()).toContain("Rename workspace › Name");
    await press(app, "\u0003");
    expect(app.lastFrame()).not.toContain("Rename workspace › Name");
    await press(app, "W");
    expect(app.lastFrame()).toContain("New workspace › Project");
    await press(app, "\u0003");
    expect(app.lastFrame()).not.toContain("New workspace › Project");
    expect(app.lastFrame()).not.toContain(quitNotice);
  });
  it("leaves the shortcut search field, then arms quit from the results", async () => {
    const { app } = await setup();
    await press(app, "\r", "?", "/", "n", "e", "\u0003");
    expect(app.lastFrame()).toContain("Keyboard shortcuts");
    expect(app.lastFrame()).not.toContain(quitNotice);
    await press(app, "\u0003");
    expect(app.lastFrame()).toContain(quitNotice);
  });
  it("leaves the question Other field and keeps the answer", async () => {
    const request: AgentPermissionRequest = {
      id: "ask",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which database?",
            header: "Database",
            multiSelect: false,
            allowOther: true,
            options: [{ label: "Postgres" }],
          },
        ],
      },
    };
    const { app } = await setup(
      [agent("alpha", { pendingPermissions: [request] })],
      30,
    );
    await press(app, "\r", "2", "x", "y");
    expect(app.lastFrame()).toContain("Other: xy▌");
    await press(app, "\u0003");
    expect(app.lastFrame()).toContain("Other: xy");
    expect(app.lastFrame()).not.toContain("Other: xy▌");
    expect(app.lastFrame()).not.toContain(quitNotice);
  });
});
