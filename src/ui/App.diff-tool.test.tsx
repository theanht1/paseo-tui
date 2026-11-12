import { expect, it } from "vitest";
import {
  agents,
  NEW_TAB,
  settle,
  settleUntil,
  setup,
} from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
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
    ...NO_PROJECT_ACTIONS,
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
      ref: (terminal) =>
        handle(typeof terminal === "string" ? terminal : terminal.id),
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

it("closes the tab as soon as the tool's process exits, before the directory catches up", async () => {
  const shell = {
    id: "shell",
    workspaceId: "one",
    cwd: "/repo/one",
    name: "Shell",
  };
  const tool = { id: "lg", workspaceId: "one", cwd: "/repo/one", name: "tig" };
  let refreshes = 0;
  let setTerminals: (terminals: (typeof shell)[]) => void = () => {};
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
      ref: (terminal) =>
        handle(typeof terminal === "string" ? terminal : terminal.id),
    },
    {
      ...NO_PROJECT_ACTIONS,
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      openFile: async () => {
        setTerminals([shell, tool]);
        return tool;
      },
      renameWorkspace: async () => {},
      closeTab: async () => {},
      archiveWorkspace: async () => {},
      renameTab: async () => {},
    },
    undefined,
    {
      diffTool: "tig status",
      refresh: async () => {
        refreshes++;
      },
    },
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
  const before = refreshes;
  result.exitTerminal("lg");
  await settle();
  expect(app.lastFrame()).not.toContain("tig main view");
  expect(app.lastFrame()).toContain("NORMAL");
  expect(test.renderer.root.findDescendantById("tab:terminal:lg")).toBeFalsy();
  expect(refreshes).toBeGreaterThan(before);
});

const shellTerminal = {
  id: "shell",
  workspaceId: "one",
  cwd: "/repo/one",
  name: "Shell",
};
const toolTerminal = {
  id: "lg",
  workspaceId: "one",
  cwd: "/repo/one",
  name: "tig",
};
/** A workspace with one shell, whose new terminals and tools show up in the directory. */
async function terminalSetup(kitty = false) {
  let setTerminals: (terminals: (typeof shellTerminal)[]) => void = () => {};
  const handle = (id: string) => ({
    id,
    current: () => null,
    refresh: async () => null,
    write: (data: string) => data.length,
    sendKeys: () => 0,
    capture: async () => ({
      terminalId: id,
      requestId: "r",
      lines: [id === "lg" ? "tig main view" : `${id} prompt`],
      totalLines: 1,
    }),
    kill: async () => {},
  });
  const created = { ...shellTerminal, id: "fresh", name: "Fresh" };
  const result = await setup(
    agents,
    24,
    kitty,
    {},
    "agents",
    {
      ref: (terminal) =>
        handle(typeof terminal === "string" ? terminal : terminal.id),
    },
    {
      ...NO_PROJECT_ACTIONS,
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        setTerminals([shellTerminal, created]);
        return created;
      },
      openFile: async () => {
        setTerminals([shellTerminal, toolTerminal]);
        return toolTerminal;
      },
      renameWorkspace: async () => {},
      closeTab: async () => {},
      archiveWorkspace: async () => {},
      renameTab: async () => {},
    },
    undefined,
    { diffTool: "tig status" },
  );
  setTerminals = result.setTerminals;
  const { app } = result;
  app.stdin.write("\r");
  await settleUntil(app.lastFrame, "Alpha agent");
  return { ...result, setTerminals };
}
async function press(
  app: Awaited<ReturnType<typeof terminalSetup>>["app"],
  keys: readonly string[],
) {
  for (const key of keys) {
    app.stdin.write(key);
    await settle();
  }
}

it("starts a new terminal tab in input mode", async () => {
  const { app } = await terminalSetup();
  await press(app, ["T"]);
  await settleUntil(app.lastFrame, "fresh prompt");
  expect(app.lastFrame()).toContain("Terminal input");
});
it("starts a terminal from the New tab wizard in input mode", async () => {
  const { app, test } = await terminalSetup();
  await press(app, [NEW_TAB]);
  test.mockInput.pressArrow("down");
  test.mockInput.pressEnter();
  await settleUntil(app.lastFrame, "fresh prompt");
  expect(app.lastFrame()).toContain("Terminal input");
});
it("starts a terminal from the Command Center in input mode", async () => {
  const { app } = await terminalSetup();
  await press(app, ["\u000b", "new terminal", "\r"]);
  await settleUntil(app.lastFrame, "fresh prompt");
  expect(app.lastFrame()).toContain("Terminal input");
});
it("opens changes from the Command Center in input mode, new or already open", async () => {
  const { app } = await terminalSetup();
  await press(app, ["\u000b", "open changes", "\r"]);
  await settleUntil(app.lastFrame, "tig main view");
  expect(app.lastFrame()).toContain("Terminal input");
  await press(app, ["\u001d", "1"]);
  expect(app.lastFrame()).not.toContain("tig main view");
  await press(app, ["\u000b", "open changes", "\r"]);
  await settleUntil(app.lastFrame, "tig main view");
  expect(app.lastFrame()).toContain("Terminal input");
});
it("returns to normal mode when an input-mode terminal exits", async () => {
  const { app, exitTerminal } = await terminalSetup();
  await press(app, ["T"]);
  await settleUntil(app.lastFrame, "fresh prompt");
  exitTerminal("fresh");
  await settle();
  expect(app.lastFrame()).not.toContain("Terminal input");
  expect(app.lastFrame()).toContain("NORMAL");
});

it("leaves a terminal's input for the last workspace with Ctrl-Tab only", async () => {
  const { app } = await terminalSetup(true);
  await press(app, ["]"]);
  await settleUntil(app.lastFrame, "hello gamma");
  await press(app, ["["]);
  await settleUntil(app.lastFrame, "hello alpha");
  await press(app, ["T"]);
  await settleUntil(app.lastFrame, "fresh prompt");
  await press(app, ["\u001b[54;5u"]);
  expect(app.lastFrame()).toContain("fresh prompt");
  expect(app.lastFrame()).toContain("Terminal input");
  await press(app, ["\u001b[9;5u"]);
  await settleUntil(app.lastFrame, "hello gamma");
  expect(app.lastFrame()).toContain("hello gamma");
  expect(app.lastFrame()).not.toContain("Terminal input");
});
