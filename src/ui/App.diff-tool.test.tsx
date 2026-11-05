import { expect, it } from "vitest";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

it("opens the diff tool in a workspace tab with gd, refocuses it, and returns when it exits", async () => {
  const opened: unknown[] = [];
  const shell = {
    id: "shell",
    workspaceId: "one",
    cwd: "/repo/one",
    name: "Shell",
  };
  const tool = { id: "lg", workspaceId: "one", cwd: "/repo/one", name: "tig" };
  let setTerminals: (terminals: (typeof shell)[]) => void = () => {};
  const management: NonNullable<AppProps["management"]> = {
    baseBranches: async () => ({ branches: [], defaultBranch: null }),
    createWorkspace: async () => {
      throw Error("Unexpected");
    },
    createAgent: async () => agent("a"),
    createTerminal: async () => {
      throw Error("Unexpected");
    },
    openFile: async (workspace, terminal) => {
      opened.push({ workspace: workspace.id, terminal });
      setTerminals([shell, tool]);
      return tool;
    },
    renameWorkspace: async () => {},
    closeTab: async () => {},
    archiveWorkspace: async () => {},
    renameTab: async () => {},
  };
  const handle = (id: string) => ({
    id,
    current: () => null,
    refresh: async () => null,
    write: (data: string) => data.length,
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: id,
      requestId: "r",
      lines: [id === "lg" ? "tig main view" : "$"],
      totalLines: 1,
    }),
    kill: async () => {},
  });
  const result = await setup(
    agents,
    24,
    false,
    {},
    undefined,
    {
      list: async () => ({ requestId: "r", entries: [] }),
      ref: (terminal) =>
        handle(typeof terminal === "string" ? terminal : terminal.id),
      create: async () => handle("lg"),
    },
    management,
    undefined,
    { diffTool: "tig status" },
  );
  setTerminals = result.setTerminals;
  const { app, test } = result;
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Alpha agent");
  for (const key of ["g", "d"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "tig main view");
  expect(opened).toEqual([
    {
      workspace: "one",
      terminal: { name: "tig", command: "sh", args: ["-c", "tig status"] },
    },
  ]);
  expect(app.lastFrame()).toContain("Terminal input");
  expect(test.renderer.root.findDescendantById("tab:terminal:lg")).toBeTruthy();

  app.stdin.write("\u001d");
  await settle();
  app.stdin.write("1");
  await settle();
  expect(app.lastFrame()).not.toContain("tig main view");
  for (const key of ["g", "d"]) {
    app.stdin.write(key);
    await settle();
  }
  await settleUntil(app.lastFrame, "tig main view");
  expect(opened).toHaveLength(1);
  expect(app.lastFrame()).toContain("Terminal input");

  setTerminals([shell]);
  await settle();
  expect(app.lastFrame()).not.toContain("tig main view");
  expect(app.lastFrame()).toContain("NORMAL");
});
