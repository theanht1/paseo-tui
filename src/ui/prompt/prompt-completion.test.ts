import { describe, expect, it } from "vitest";
import type { CompletionPort, SlashCommand } from "../../connection/ports.js";
import {
  applyCompletion,
  createCompletionStore,
  findTrigger,
  rankCommands,
} from "./prompt-completion.js";

const commands: SlashCommand[] = [
  {
    name: "compact",
    description: "Compact context",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "review",
    description: "Review code",
    argumentHint: "[pr]",
    kind: "skill",
  },
  { name: "clear", description: "Clear", argumentHint: "", kind: "command" },
];

describe("findTrigger", () => {
  it("opens slash completion at the start of the prompt", () => {
    expect(findTrigger("/co", 3)).toEqual({
      kind: "slash",
      start: 0,
      end: 3,
      query: "co",
      position: "start",
    });
  });
  it("opens inline slash completion only after whitespace", () => {
    expect(findTrigger("run /rev", 8)).toMatchObject({
      kind: "slash",
      start: 4,
      query: "rev",
      position: "inline",
    });
    expect(findTrigger("a/b", 3)).toBeNull();
  });
  it("closes once the token contains whitespace", () => {
    expect(findTrigger("/compact now", 12)).toBeNull();
  });
  it("opens file mentions at token start, not inside words", () => {
    expect(findTrigger("look at @src/ui", 15)).toEqual({
      kind: "file",
      start: 8,
      end: 15,
      query: "src/ui",
    });
    expect(findTrigger("me@example", 10)).toBeNull();
  });
  it("only considers text before the cursor", () => {
    expect(findTrigger("/co later", 3)).toMatchObject({ query: "co" });
  });
});

describe("rankCommands", () => {
  it("fuzzy filters by name and keeps only skills inline", () => {
    expect(
      rankCommands(commands, { query: "cmp", position: "start" }).map(
        (c) => c.name,
      ),
    ).toEqual(["compact"]);
    expect(
      rankCommands(commands, { query: "", position: "inline" }).map(
        (c) => c.name,
      ),
    ).toEqual(["review"]);
  });
});

describe("applyCompletion", () => {
  it("replaces the slash token and adds a space at the end", () => {
    const trigger = findTrigger("/co", 3);
    if (!trigger) throw Error("trigger");
    expect(applyCompletion("/co", trigger, "/compact")).toEqual({
      text: "/compact ",
      cursor: 9,
    });
  });
  it("inserts a quoted @path when the path has spaces", () => {
    const text = "see @my fi and more";
    const trigger = findTrigger(text, 7);
    if (!trigger) throw Error("trigger");
    expect(applyCompletion(text, trigger, "@my file.ts")).toEqual({
      text: 'see @"my file.ts" fi and more',
      cursor: 17,
    });
  });
});

class FakePort implements CompletionPort {
  commandCalls = 0;
  fileQueries: string[] = [];
  async commands() {
    this.commandCalls++;
    return commands;
  }
  async files(_cwd: string, query: string) {
    this.fileQueries.push(query);
    return [
      { path: `${query}/a.ts`, kind: "file" as const },
      { path: `${query}/dir`, kind: "directory" as const },
    ];
  }
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("completion store", () => {
  it("loads commands once, filters as you type and accepts the selection", async () => {
    const port = new FakePort();
    const store = createCompletionStore(port, {
      source: { kind: "agent", agentId: "a" },
      cwd: "/repo",
    });
    store.update("/", 1);
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      kind: "open",
      items: [{ label: "/compact" }, { label: "/review" }, { label: "/clear" }],
      index: 0,
    });
    store.update("/c", 2);
    await flush();
    store.move(1);
    expect(store.getSnapshot()).toMatchObject({ index: 1 });
    store.move(5);
    expect(store.getSnapshot()).toMatchObject({ index: 0 });
    expect(store.accept()).toEqual({ text: "/compact ", cursor: 9 });
    expect(store.getSnapshot().kind).toBe("closed");
    expect(port.commandCalls).toBe(1);
  });

  it("stays dismissed for the same token after Esc", async () => {
    const store = createCompletionStore(new FakePort(), {
      source: { kind: "agent", agentId: "a" },
      cwd: "/repo",
    });
    store.update("/", 1);
    await flush();
    store.dismiss();
    store.update("/c", 2);
    expect(store.getSnapshot().kind).toBe("closed");
    store.update("", 0);
    store.update("/", 1);
    await flush();
    expect(store.getSnapshot().kind).toBe("open");
  });

  it("debounces file queries and inserts @relative/path", async () => {
    const port = new FakePort();
    const timers: (() => void)[] = [];
    const store = createCompletionStore(port, {
      source: { kind: "agent", agentId: "a" },
      cwd: "/repo",
      debounce: (run) => {
        timers.push(run);
        return () => {
          timers.splice(timers.indexOf(run), 1);
        };
      },
    });
    store.update("@s", 2);
    store.update("@sr", 3);
    store.update("@src", 4);
    expect(port.fileQueries).toEqual([]);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    await flush();
    expect(port.fileQueries).toEqual(["src"]);
    expect(store.getSnapshot()).toMatchObject({
      kind: "open",
      items: [{ label: "src/a.ts" }, { label: "src/dir/" }],
    });
    expect(store.accept(1)).toEqual({ text: "@src/dir/", cursor: 9 });
  });

  it("ignores stale file responses", async () => {
    let resolveFirst: (value: { path: string; kind: "file" }[]) => void =
      () => {};
    const port: CompletionPort = {
      commands: async () => [],
      files: (_cwd, query) =>
        query === "a"
          ? new Promise((resolve) => {
              resolveFirst = resolve;
            })
          : Promise.resolve([{ path: "b.ts", kind: "file" }]),
    };
    const store = createCompletionStore(port, {
      source: { kind: "agent", agentId: "a" },
      cwd: "/repo",
      debounce: (run) => {
        run();
        return () => {};
      },
    });
    store.update("@a", 2);
    store.update("@b", 2);
    await flush();
    resolveFirst([{ path: "a.ts", kind: "file" }]);
    await flush();
    expect(store.getSnapshot()).toMatchObject({ items: [{ label: "b.ts" }] });
  });

  it("reports a command loading error in the popup", async () => {
    const store = createCompletionStore(
      {
        commands: async () => {
          throw Error("provider down");
        },
        files: async () => [],
      },
      { source: { kind: "agent", agentId: "a" }, cwd: "/repo" },
    );
    store.update("/", 1);
    await flush();
    expect(store.getSnapshot()).toMatchObject({
      kind: "open",
      items: [],
      error: "provider down",
    });
  });
});
