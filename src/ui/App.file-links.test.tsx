import { describe, expect, it } from "vitest";
import { agents, settle, setup } from "../test/app-harness.js";
import { agent } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

describe("file links", () => {
  async function fileSetup() {
    const opened: unknown[] = [];
    const vim = {
      id: "vim",
      workspaceId: "one",
      cwd: "/repo/one",
      name: "app.ts",
    };
    const shell = {
      id: "shell",
      workspaceId: "one",
      cwd: "/repo/one",
      name: "Shell",
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
        lines: [id === "vim" ? "~ vim buffer" : "$"],
        totalLines: 1,
      }),
      kill: async () => {},
    });
    const listed: string[] = [];
    let setTerminals: (terminals: (typeof vim)[]) => void = () => {};
    const management: NonNullable<AppProps["management"]> = {
      baseBranches: async () => ({ branches: [], defaultBranch: null }),
      createWorkspace: async () => {
        throw Error("Unexpected");
      },
      createAgent: async () => agent("a"),
      createTerminal: async () => {
        throw Error("Unexpected");
      },
      openFile: async (workspace, editor) => {
        opened.push({ workspace: workspace.id, editor });
        setTerminals([shell, vim]);
        return vim;
      },
      renameWorkspace: async () => {},
      closeTab: async () => {},
      archiveWorkspace: async () => {},
      renameTab: async () => {},
    };
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
        create: async () => handle("vim"),
      },
      management,
      undefined,
      {
        directories: {
          async list(directory) {
            listed.push(directory);
            return directory === "/repo/one/src"
              ? [{ name: "app.ts", kind: "file" as const }]
              : [];
          },
        },
      },
      (id) =>
        id === "alpha"
          ? [
              { type: "user_message", text: "hello alpha" },
              {
                type: "assistant_message",
                text: "Edit `src/app.ts:7` now, not src/gone.ts",
              },
            ]
          : null,
    );
    setTerminals = result.setTerminals;
    result.app.stdin.write("\r");
    await settle();
    for (let i = 0; i < 100 && !result.app.lastFrame().includes("now,"); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await settle();
    }
    return { ...result, opened, listed, shell };
  }
  const expected = {
    workspace: "one",
    editor: {
      name: "app.ts",
      command: "vim",
      args: ["+7", "--", "/repo/one/src/app.ts"],
    },
  };
  async function expectEditorTab(
    test: Awaited<ReturnType<typeof setup>>["test"],
    frame: () => string,
  ) {
    await settle();
    expect(frame()).toContain("~ vim buffer");
    expect(frame()).toContain("Terminal input");
    const tab = test.renderer.root.findDescendantById("tab:terminal:vim");
    expect(tab).toBeTruthy();
  }

  it("underlines verified paths, opens a clicked one in a vim tab and returns when vim exits", async () => {
    const { app, test, opened, listed, setTerminals, shell } =
      await fileSetup();
    expect(listed).toContain("/repo/one/src");
    const spans = test.captureSpans().lines.flatMap((line) => line.spans);
    const link = spans.find((span) => span.text === "src/app.ts:7");
    expect(link?.attributes ?? 0).toBeTruthy();
    expect(link?.fg.toInts().slice(0, 3).join(",")).toBe("130,170,255");
    expect(spans.some((span) => span.text === "src/gone.ts")).toBe(false);
    const lines = app.lastFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("src/app.ts:7"));
    const col = lines[row]?.indexOf("src/app.ts:7") ?? 0;
    await test.mockMouse.click(col + 3, row);
    await expectEditorTab(test, app.lastFrame);
    expect(opened).toEqual([expected]);
    setTerminals([shell]);
    await settle();
    expect(app.lastFrame()).toContain("hello alpha");
    expect(app.lastFrame()).toContain("NORMAL");
  });

  it("labels visible paths with F and opens the typed hint", async () => {
    const { app, test, opened } = await fileSetup();
    app.stdin.write("F");
    await settle();
    expect(app.lastFrame()).toContain("HINT");
    expect(app.lastFrame()).toContain("Open the labelled file in vim");
    const spans = test.captureSpans().lines.flatMap((line) => line.spans);
    expect(
      spans.some(
        (span) =>
          span.text === "a" &&
          span.bg.toInts().slice(0, 3).join(",") === "130,170,255",
      ),
    ).toBe(true);
    app.stdin.write("a");
    await expectEditorTab(test, app.lastFrame);
    expect(opened).toEqual([expected]);
  });

  it("cancels hints with Esc", async () => {
    const { app, opened } = await fileSetup();
    app.stdin.write("F");
    await settle();
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).toContain("NORMAL");
    expect(opened).toEqual([]);
  });

  it("opens the path under the copy cursor with gf", async () => {
    const { app, test, opened } = await fileSetup();
    for (const key of ["\u0002", "[", "w", "l", "g", "f"]) {
      app.stdin.write(key);
      await settle();
    }
    await expectEditorTab(test, app.lastFrame);
    expect(opened).toEqual([expected]);
  });

  it("lists chat files in the Command Center and opens the chosen one", async () => {
    const { app, test, opened } = await fileSetup();
    app.stdin.write(":");
    await settle();
    for (const key of [..."open file from", "\r"]) app.stdin.write(key);
    await settle();
    expect(app.lastFrame()).toContain("src/app.ts:7");
    expect(app.lastFrame()).not.toContain("gone.ts");
    app.stdin.write("\r");
    await expectEditorTab(test, app.lastFrame);
    expect(opened).toEqual([expected]);
  });
});
