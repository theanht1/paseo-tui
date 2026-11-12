import { describe, expect, it } from "vitest";
import { createCompletionAdapter } from "../connection/daemon-adapter.js";
import type { CommandListSource } from "../connection/ports.js";
import { agents, settle, setup } from "../test/app-harness.js";
import type { AppProps } from "./App.js";

describe("prompt drafts", () => {
  /** Presses each key in turn; a lone Escape needs the parser's timeout to pass. */
  async function type(
    app: Awaited<ReturnType<typeof setup>>["app"],
    ...keys: string[]
  ) {
    for (const key of keys) {
      app.stdin.write(key);
      if (key === "\u001b")
        await new Promise((resolve) => setTimeout(resolve, 40));
      await settle();
    }
  }
  it("keeps the typed message across switching agent tabs", async () => {
    const { app } = await setup();
    await type(app, "\r", "i", ..."half a thought", "\u001b", "g", "t");
    expect(app.lastFrame()).toContain("hello beta");
    expect(app.lastFrame()).not.toContain("half a thought");
    await type(app, "g", "T");
    expect(app.lastFrame()).toContain("half a thought");
  });
  it("keeps the cursor where it was", async () => {
    const { app, ports } = await setup();
    await type(
      app,
      "\r",
      "i",
      "a",
      "d",
      "\u001b[D",
      "\u001b",
      "g",
      "t",
      "g",
      "T",
      "i",
      "b",
      "\r",
    );
    expect(ports.get("alpha")?.sent).toEqual(["abd"]);
  });
  it("forgets the message once it is sent", async () => {
    const { app, ports } = await setup();
    await type(app, "\r", "i", ..."done", "\r");
    expect(ports.get("alpha")?.sent).toEqual(["done"]);
    await type(app, "g", "t", "g", "T");
    expect(app.lastFrame()).toContain("Press i or a to message Alpha agent");
  });
});

describe("prompt history", () => {
  async function history() {
    const harness = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      (id) => [
        { type: "user_message", text: `older ${id}` },
        { type: "assistant_message", text: "ok" },
        { type: "user_message", text: `newer ${id}` },
      ],
    );
    const type = async (...keys: string[]) => {
      for (const key of keys) {
        harness.app.stdin.write(key);
        await settle();
      }
    };
    await type("\r", "i");
    return { ...harness, type };
  }
  it("recalls older prompts with Up or Ctrl-P and newer ones with Down or Ctrl-N", async () => {
    const { ports, type } = await history();
    await type("\u001b[A", "\u0010", "\u001b[B", "\r");
    await type("i", "\u0010", "\u001b[A", "\u000e", "\r");
    expect(ports.get("alpha")?.sent).toEqual(["newer alpha", "newer alpha"]);
  });
  it("goes back to an empty input past the newest prompt", async () => {
    const { ports, type } = await history();
    await type("\u001b[A", "\u001b[B", ..."fresh", "\r");
    expect(ports.get("alpha")?.sent).toEqual(["fresh"]);
  });
  it("leaves the keys alone once the input has the user's own changes", async () => {
    const { ports, type } = await history();
    await type(..."draft", "\u0010", "\u001b[A", "\r");
    await type("i", "\u001b[A", "!", "\u001b[A", "\u000e", "\r");
    expect(ports.get("alpha")?.sent).toEqual(["draft", "newer alpha!"]);
  });
});

describe("prompt completions and external editor", () => {
  const completions = {
    fileQueries: [] as string[],
    async commands(source: CommandListSource) {
      expect(source).toEqual({ kind: "agent", agentId: "alpha" });
      return [
        {
          name: "compact",
          description: "Compact context",
          argumentHint: "",
          kind: "command" as const,
        },
        {
          name: "review",
          description: "Review code",
          argumentHint: "[pr]",
          kind: "skill" as const,
        },
      ];
    },
    async files(cwd: string, query: string) {
      expect(cwd).toBe("/repo/one");
      this.fileQueries.push(query);
      return [{ path: "src/app.ts", kind: "file" as const }];
    },
  };
  async function open(extra: Partial<AppProps>) {
    const result = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      extra,
    );
    for (const key of ["\r", "i"]) {
      result.app.stdin.write(key);
      await settle();
    }
    return result;
  }
  it("lists slash commands, filters, moves with Ctrl-N and accepts with Tab", async () => {
    const { app, ports } = await open({ completions });
    app.stdin.write("/");
    await settle();
    expect(app.lastFrame()).toContain("/compact");
    expect(app.lastFrame()).toContain("/review");
    app.stdin.write("\u000e");
    await settle();
    expect(app.lastFrame()).not.toContain("New tab ›");
    app.stdin.write("\t");
    await settle();
    expect(app.lastFrame()).toContain("/review ");
    expect(app.lastFrame()).not.toContain("Compact context");
    app.stdin.write("\r");
    await settle();
    expect(ports.get("alpha")?.sent).toEqual(["/review"]);
  });
  it("dismisses with Esc and accepts with a click", async () => {
    const { app, test } = await open({ completions });
    app.stdin.write("/");
    await settle();
    app.stdin.write("\u001b");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
    expect(app.lastFrame()).not.toContain("Compact context");
    expect(app.lastFrame()).toContain("INSERT");
    app.stdin.write("\u007f");
    await settle();
    app.stdin.write("/");
    await settle();
    const item = test.renderer.root.findDescendantById("completion:1");
    if (!item) throw Error("Missing completion row");
    await test.mockMouse.click(item.x + 1, item.y);
    await settle();
    expect(app.lastFrame()).toContain("/review ");
  });
  it("searches workspace files after @ and inserts @relative/path", async () => {
    const { app } = await open({ completions });
    for (const key of ["@", "a", "p"]) app.stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();
    expect(completions.fileQueries).toEqual(["ap"]);
    expect(app.lastFrame()).toContain("src/app.ts");
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("@src/app.ts ");
  });
  it("edits the prompt in the external editor with Ctrl-G", async () => {
    const edited: string[] = [];
    const { app } = await open({
      editPrompt: async (text) => {
        edited.push(text);
        return `${text} from editor`;
      },
    });
    for (const key of ["h", "i", "\u0007"]) app.stdin.write(key);
    await settle();
    expect(edited).toEqual(["hi"]);
    expect(app.lastFrame()).toContain("hi from editor");
  });
  it("lists the open agent's commands through the daemon adapter", async () => {
    const requests: unknown[] = [];
    const { app } = await open({
      completions: createCompletionAdapter({
        async listCommands(options) {
          requests.push(options);
          return {
            agentId: options.agentId,
            requestId: "r",
            error: null,
            commands: [
              {
                name: "compact",
                description: "Compact context",
                argumentHint: "",
              },
            ],
          };
        },
        async getDirectorySuggestions() {
          return { requestId: "r", error: null, entries: [] };
        },
      }),
    });
    app.stdin.write("/");
    await settle();
    expect(app.lastFrame()).toContain("/compact");
    expect(requests).toEqual([{ agentId: "alpha" }]);
  });
  it("completes / commands and @ files in the new-workspace prompt from the draft config", async () => {
    const sources: CommandListSource[] = [];
    const fileRoots: string[] = [];
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      "agents",
      undefined,
      undefined,
      undefined,
      {
        completions: {
          async commands(source) {
            sources.push(source);
            return [
              {
                name: "compact",
                description: "Compact context",
                argumentHint: "",
                kind: "command",
              },
            ];
          },
          async files(cwd) {
            fileRoots.push(cwd);
            return [{ path: "src/app.ts", kind: "file" }];
          },
        },
      },
    );
    for (const key of ["W", "\r", "\r", "\r", "\r", "\r", "Title", "\r"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("First prompt");
    app.stdin.write("/");
    await settle();
    expect(app.lastFrame()).toContain("/compact");
    expect(sources).toEqual([
      {
        kind: "draft",
        config: {
          provider: "codex",
          cwd: "/repo",
          model: "best",
          modeId: "ask",
        },
      },
    ]);
    app.stdin.write("\t");
    await settle();
    expect(app.lastFrame()).toContain("/compact ");
    for (const key of ["@", "a", "p"]) app.stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();
    expect(app.lastFrame()).toContain("src/app.ts");
    expect(fileRoots.at(-1)).toBe("/repo");
    app.stdin.write("\r");
    await settle();
    expect(app.lastFrame()).toContain("/compact @src/app.ts");
    expect(app.lastFrame()).toContain("First prompt");
  });
  it("runs the external editor and copy mode from Command Center Actions", async () => {
    const edited: string[] = [];
    const { app, test } = await open({
      editPrompt: async (text) => {
        edited.push(text);
        return "palette draft";
      },
    });
    async function pressEscape() {
      test.mockInput.pressEscape();
      await new Promise((resolve) => setTimeout(resolve, 40));
      await settle();
    }
    await pressEscape();
    app.stdin.write(":");
    await settle();
    for (const key of [..."edit prompt", "\r"]) app.stdin.write(key);
    await settle();
    expect(edited).toEqual([""]);
    expect(app.lastFrame()).toContain("palette draft");
    expect(app.lastFrame()).toContain("INSERT");
    await pressEscape();
    app.stdin.write(":");
    await settle();
    for (const key of [..."copy mode", "\r"]) app.stdin.write(key);
    await settle();
    expect(app.lastFrame()).toContain("COPY");
  });
});
