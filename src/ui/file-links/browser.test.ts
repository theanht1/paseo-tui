import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  type BrowserCommand,
  browserCommand,
  spawnBrowserRunner,
  systemBrowser,
} from "./browser.js";

describe("browserCommand", () => {
  it("uses the platform's opener with the URL as one argument", () => {
    const url = "https://x.dev/a?b=1&c=2";
    expect(browserCommand("darwin", url)).toEqual({
      command: "open",
      args: [url],
    });
    expect(browserCommand("linux", url)).toEqual({
      command: "xdg-open",
      args: [url],
    });
    expect(browserCommand("win32", url)).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", url],
    });
  });
});

describe("systemBrowser", () => {
  it("runs the opener and reports a missing one", async () => {
    const calls: BrowserCommand[] = [];
    const browser = systemBrowser("linux", {
      async run(command) {
        calls.push(command);
        return { kind: "missing" };
      },
    });
    expect(await browser.open("https://x.dev")).toBe(
      "no browser opener found: install xdg-utils",
    );
    expect(calls).toEqual([{ command: "xdg-open", args: ["https://x.dev"] }]);
  });
  it("reports success and failures", async () => {
    const ok = systemBrowser("darwin", { run: async () => ({ kind: "ok" }) });
    expect(await ok.open("https://x.dev")).toBeNull();
    const failed = systemBrowser("darwin", {
      run: async () => ({ kind: "failed", message: "open: denied" }),
    });
    expect(await failed.open("https://x.dev")).toBe("open: denied");
  });
});

describe("spawnBrowserRunner", () => {
  class FakeChild extends EventEmitter {
    unrefs = 0;
    unref() {
      this.unrefs++;
    }
  }
  it("spawns detached without a shell and lets the opener outlive the TUI", async () => {
    const spawned: {
      command: string;
      args: readonly string[];
      options: object;
    }[] = [];
    const child = new FakeChild();
    const runner = spawnBrowserRunner((command, args, options) => {
      spawned.push({ command, args, options });
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const result = await runner.run({
      command: "open",
      args: ["https://x.dev/$(rm -rf ~)"],
    });
    expect(result).toEqual({ kind: "ok" });
    expect(spawned).toEqual([
      {
        command: "open",
        args: ["https://x.dev/$(rm -rf ~)"],
        options: { stdio: "ignore", detached: true, shell: false },
      },
    ]);
    expect(child.unrefs).toBe(1);
  });
  it("turns ENOENT into a missing opener", async () => {
    const child = new FakeChild();
    const runner = spawnBrowserRunner(() => {
      queueMicrotask(() =>
        child.emit("error", Object.assign(Error("nope"), { code: "ENOENT" })),
      );
      return child;
    });
    expect(await runner.run({ command: "xdg-open", args: [] })).toEqual({
      kind: "missing",
    });
  });
});
