import { describe, expect, it } from "vitest";
import { agents, settle, setup } from "../test/app-harness.js";
import { agent, NO_PROJECT_ACTIONS } from "../test/fixtures.js";
import type { AppProps } from "./App.js";

describe("file links", () => {
  async function fileSetup(
    text = "Edit `src/app.ts:7` now, not src/gone.ts",
    extra: Partial<AppProps> = {},
  ) {
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
    const copied: string[] = [];
    let setTerminals: (terminals: (typeof vim)[]) => void = () => {};
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
        ref: (terminal) =>
          handle(typeof terminal === "string" ? terminal : terminal.id),
      },
      management,
      undefined,
      {
        clipboard: {
          copyToClipboardOSC52(text: string) {
            copied.push(text);
            return true;
          },
        },
        directories: {
          async list(directory) {
            listed.push(directory);
            return directory === "/repo/one/src"
              ? [{ name: "app.ts", kind: "file" as const }]
              : [];
          },
        },
        ...extra,
      },
      (id) =>
        id === "alpha"
          ? [
              { type: "user_message", text: "hello alpha" },
              {
                type: "assistant_message",
                text,
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
    return { ...result, opened, listed, shell, copied };
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
    expect(app.lastFrame()).toContain("Open the labelled file or link");
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

  it("copies the workspace path and the editor tab's file path from the Command Center", async () => {
    const { app, test, copied } = await fileSetup();
    app.stdin.write("F");
    await settle();
    app.stdin.write("a");
    await expectEditorTab(test, app.lastFrame);
    for (const [query, path] of [
      ["copy workspace path", "/repo/one"],
      ["copy file path relative", "src/app.ts"],
      ["copy file path absolute", "/repo/one/src/app.ts"],
    ] as const) {
      for (const key of ["\u001d", "\u000b", query]) {
        app.stdin.write(key);
        await settle();
      }
      expect(app.lastFrame()).toContain(path);
      app.stdin.write("\r");
      await settle();
      expect(copied.at(-1)).toBe(path);
    }
    expect(app.lastFrame()).toContain("Copied 20 chars");
  });

  function fakeBrowser() {
    const urls: string[] = [];
    return {
      urls,
      browser: {
        async open(url: string) {
          urls.push(url);
          return null;
        },
      },
    };
  }
  const linkChat =
    "See [the docs](https://docs.dev/guide), https://x.dev/a?q=1 now, `src/app.ts:7`";
  it("labels URLs and markdown link labels with F and opens them in the browser", async () => {
    const { urls, browser } = fakeBrowser();
    const { app, test, opened } = await fileSetup(linkChat, { browser });
    expect(app.lastFrame()).toContain("the docs");
    for (const [label, url] of [
      ["a", "https://docs.dev/guide"],
      ["s", "https://x.dev/a?q=1"],
    ] as const) {
      app.stdin.write("F");
      await settle();
      expect(app.lastFrame()).toContain("HINT");
      expect(test.renderer.root.findDescendantById("file-hint:f")).toBeFalsy();
      app.stdin.write(label);
      await settle();
      expect(urls.at(-1)).toBe(url);
      expect(app.lastFrame()).toContain("NORMAL");
    }
    expect(opened).toEqual([]);
    app.stdin.write("F");
    await settle();
    app.stdin.write("d");
    await expectEditorTab(test, app.lastFrame);
    expect(opened).toEqual([expected]);
  });
  it("opens a clicked URL in the browser and warns about localhost from a remote host", async () => {
    const { urls, browser } = fakeBrowser();
    const { app, test } = await fileSetup(
      "Served at http://localhost:5173/app now, done",
      { browser, isRemoteAgent: (agentId) => agentId === "alpha" },
    );
    const lines = app.lastFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("localhost:5173"));
    const col = lines[row]?.indexOf("localhost:5173") ?? 0;
    await test.mockMouse.click(col, row);
    await settle();
    expect(urls).toEqual(["http://localhost:5173/app"]);
    expect(app.lastFrame()).toContain(
      "Opened locally; localhost refers to this machine",
    );
  });
  it("reports a missing browser opener", async () => {
    const { app } = await fileSetup("See https://x.dev/a now, done", {
      browser: {
        open: async () => "no browser opener found: install xdg-utils",
      },
    });
    app.stdin.write("F");
    await settle();
    app.stdin.write("a");
    await settle();
    expect(app.lastFrame()).toContain(
      "no browser opener found: install xdg-utils",
    );
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
