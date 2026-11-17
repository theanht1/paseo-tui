import { expect, it } from "vitest";
import type { CreateAgentInput } from "../state/ports.js";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

it("Transfer agents recreates the current agent in this workspace on a newly chosen provider and model", async () => {
  const created: { workspace: string; input: CreateAgentInput }[] = [];
  const management: NonNullable<AppProps["management"]> = {
    ...NO_PROJECT_ACTIONS,
    checkout: () => ({
      status: async () => ({
        branch: "feat",
        dirty: false,
        baseRef: "origin/main",
      }),
      switchBranch: async () => {},
      renameBranch: async () => {},
      stash: async () => {},
      unstash: async () => {},
      push: async () => {},
    }),
    forkChat: async (chat) => ({
      type: "text",
      mimeType: "text/plain",
      text: `chat ${chat.id}`,
    }),
    baseBranches: async () => ({ branches: ["main"], defaultBranch: "main" }),
    openFile: async () => {
      throw Error("Unexpected");
    },
    createWorkspace: async () => {
      throw Error("Unexpected workspace");
    },
    createAgent: async (workspace, input) => {
      created.push({ workspace: workspace.id, input });
      return agent("moved", { workspaceId: workspace.id });
    },
    createTerminal: async () => {
      throw Error("Unexpected terminal");
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
  const { app } = await setup(
    agents,
    30,
    false,
    {},
    "agents",
    undefined,
    management,
  );
  for (const key of ["\r", ":", "Transfer agents", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "This workspace");
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Change provider & model…");
  for (const key of ["\u000e", "\r"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "Codex");
  for (const option of ["Codex", "Best", "Ask"]) {
    await settleUntil(app.lastFrame, option);
    app.stdin.write("\r");
    await settle();
  }
  await settleUntil(app.lastFrame, "As codex · best");
  app.stdin.write("\r");
  for (let i = 0; i < 50 && created.length === 0; i++) await settle();
  expect(created).toEqual([
    {
      workspace: "one",
      input: expect.objectContaining({
        provider: "codex",
        model: "best",
        modeId: "ask",
        title: "Alpha agent",
        attachments: [expect.objectContaining({ text: "chat alpha" })],
      }),
    },
  ]);
});
