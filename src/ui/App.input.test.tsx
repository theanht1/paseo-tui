import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
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
  it("runs app shortcuts like Ctrl-^ while a question prompt has focus", async () => {
    const asking = agent("alpha", {
      cwd: "/repo/one",
      workspaceId: "one",
      pendingPermissions: [
        {
          id: "ask",
          provider: "claude",
          name: "AskUserQuestion",
          kind: "question",
          input: {
            questions: [
              {
                question: "Which database?",
                header: "Database",
                options: [{ label: "Postgres" }],
              },
            ],
          },
        },
      ],
    });
    const other = agent("gamma", { cwd: "/repo/two", workspaceId: "two" });
    const { app } = await setup([other, asking], 30);
    await press(app, "\r", "]");
    await settleUntil(app.lastFrame, "Which database?");
    await press(app, "\u001e");
    await settleUntil(app.lastFrame, "hello gamma");
    expect(app.lastFrame()).toContain("hello gamma");
  });
  it("shows all of a long question, wrapped", async () => {
    const request: AgentPermissionRequest = {
      id: "ask",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: `${"lorem ipsum ".repeat(30)}finalword`,
            header: "Database",
            options: [{ label: "Postgres" }],
          },
        ],
      },
    };
    const { app } = await setup(
      [agent("alpha", { pendingPermissions: [request] })],
      30,
    );
    await press(app, "\r");
    expect(app.lastFrame()).toContain("finalword");
  });
  it("wraps a long question option instead of cutting it off", async () => {
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
            options: [{ label: "Postgres", description: longText }],
          },
        ],
      },
    };
    const { app } = await setup(
      [agent("alpha", { pendingPermissions: [request] })],
      30,
    );
    await press(app, "\r");
    expect(app.lastFrame()).toContain("end-marker");
  });
});

const longText = `start-marker ${"lorem ipsum ".repeat(18)}end-marker`;
/** Fits the three rows of a Command Center or shortcut search field. */
const fieldText = `start-marker ${"lorem ipsum ".repeat(12)}end-marker`;
it("wraps a long agent prompt so its start and end stay visible", async () => {
  const { app } = await setup();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello alpha");
  app.stdin.write("i");
  await settle();
  app.stdin.write(longText);
  await settle();
  expect(app.lastFrame()).toContain("start-marker");
  expect(app.lastFrame()).toContain("end-marker");
});
it("keeps wrapping when text is typed one word at a time", async () => {
  const { app } = await setup();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello alpha");
  app.stdin.write("i");
  await settle();
  for (const word of longText.split(" ")) {
    app.stdin.write(`${word} `);
    await settle();
  }
  expect(app.lastFrame()).toContain("start-marker");
  expect(app.lastFrame()).toContain("end-marker");
});
it("wraps long text in the Command Center", async () => {
  const { app } = await setup();
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "hello alpha");
  app.stdin.write("\u000b");
  await settle();
  for (const word of fieldText.split(" ")) {
    app.stdin.write(`${word} `);
    await settle();
  }
  expect(app.lastFrame()).toContain("start-marker");
  expect(app.lastFrame()).toContain("end-marker");
});
it("wraps long text in the shortcut search", async () => {
  const { app } = await setup();
  app.stdin.write("?");
  await settle();
  app.stdin.write("\t");
  await settle();
  for (const word of fieldText.split(" ")) {
    app.stdin.write(`${word} `);
    await settle();
  }
  expect(app.lastFrame()).toContain("start-marker");
  expect(app.lastFrame()).toContain("end-marker");
});
