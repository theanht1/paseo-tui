import { describe, expect, it } from "vitest";
import {
  type ClipboardCommand,
  clipboardCommands,
  copyText,
  type RunResult,
  systemClipboard,
} from "./clipboard.js";

function runner(results: Record<string, RunResult>) {
  const calls: { command: string; input: string }[] = [];
  return {
    calls,
    async run(command: ClipboardCommand, input: string) {
      calls.push({
        command: [command.command, ...command.args].join(" "),
        input,
      });
      return results[command.command] ?? { kind: "missing" as const };
    },
  };
}

describe("clipboardCommands", () => {
  it("picks the platform's tools in fallback order", () => {
    const names = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) =>
      clipboardCommands(platform, env).map((c) =>
        [c.command, ...c.args].join(" "),
      );
    expect(names("darwin")).toEqual(["pbcopy"]);
    expect(names("win32")).toEqual(["clip.exe"]);
    expect(names("linux")).toEqual([
      "xclip -selection clipboard",
      "xsel --clipboard --input",
    ]);
    expect(names("linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual([
      "wl-copy",
      "xclip -selection clipboard",
      "xsel --clipboard --input",
    ]);
  });
});

describe("systemClipboard", () => {
  it("writes the exact text to the first available tool's stdin", async () => {
    const fake = runner({ xsel: { kind: "ok" } });
    const clipboard = systemClipboard("linux", {}, fake);
    expect(await clipboard.write("héllo\nworld")).toEqual({ ok: true });
    expect(fake.calls).toEqual([
      { command: "xclip -selection clipboard", input: "héllo\nworld" },
      { command: "xsel --clipboard --input", input: "héllo\nworld" },
    ]);
  });
  it("names the tools to install when none exists, and reports a tool failure", async () => {
    expect(await systemClipboard("linux", {}, runner({})).write("x")).toEqual({
      ok: false,
      error: "no clipboard tool found: install xclip, xsel or wl-clipboard",
    });
    expect(
      await systemClipboard(
        "darwin",
        {},
        runner({ pbcopy: { kind: "failed", message: "pbcopy exited with 1" } }),
      ).write("x"),
    ).toEqual({ ok: false, error: "pbcopy exited with 1" });
  });
});

describe("copyText", () => {
  it("copies natively and through OSC 52, succeeding when either works", async () => {
    const osc: string[] = [];
    const writer = {
      copyToClipboardOSC52(text: string) {
        osc.push(text);
        return false;
      },
    };
    const ok = { write: async () => ({ ok: true as const }) };
    expect(await copyText(writer, ok, "héllo\nworld")).toBe("Copied 11 chars");
    expect(osc).toEqual(["héllo\nworld"]);
    const failing = {
      write: async () => ({
        ok: false as const,
        error: "no clipboard tool found: install xclip",
      }),
    };
    expect(
      await copyText({ copyToClipboardOSC52: () => true }, failing, "x"),
    ).toBe("Copied 1 char");
    expect(await copyText(writer, failing, "x")).toBe(
      "Clipboard unavailable: no clipboard tool found: install xclip",
    );
    expect(await copyText(writer, null, "x")).toBe(
      "Clipboard unavailable: terminal does not support OSC 52",
    );
    expect(await copyText(writer, ok, "")).toBeNull();
  });
});
