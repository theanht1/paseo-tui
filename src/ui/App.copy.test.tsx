import { describe, expect, it } from "vitest";

import { agents, settle, setup } from "../test/app-harness.js";

describe("copy mode and clipboard", () => {
  function clipboard() {
    const copied: string[] = [];
    return {
      copied,
      writer: {
        copyToClipboardOSC52(text: string) {
          copied.push(text);
          return true;
        },
      },
    };
  }
  it("enters copy mode with prefix [, yanks a line selection and shows a notice", async () => {
    const { copied, writer } = clipboard();
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { clipboard: writer },
    );
    app.stdin.write("\r");
    await settle();
    app.stdin.write("\u0002");
    await settle();
    app.stdin.write("[");
    await settle();
    expect(app.lastFrame()).toContain("COPY");
    expect(app.lastFrame()).toContain("Copy selection and exit");
    for (const key of ["g", "g", "V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(copied).toEqual(["hello alpha"]);
    expect(app.lastFrame()).toContain("Copied 11 chars");
    expect(app.lastFrame()).toContain("NORMAL");
  });
  it("exits copy mode with q or Ctrl-C without copying", async () => {
    const { copied, writer } = clipboard();
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { clipboard: writer },
    );
    for (const key of ["\r", "\u0002", "[", "q"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("NORMAL");
    for (const key of ["\u0002", "[", "\u0003"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("NORMAL");
    expect(app.lastFrame()).not.toContain("Press Ctrl+C again to quit");
    expect(copied).toEqual([]);
  });
  it("copies a mouse drag selection on release", async () => {
    const { copied, writer } = clipboard();
    const { app, test } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { clipboard: writer },
    );
    app.stdin.write("\r");
    await settle();
    const lines = app.lastFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("hello alpha"));
    const col = lines[row]?.indexOf("hello alpha") ?? 0;
    await test.mockMouse.drag(col, row, col + 4, row);
    await settle();
    expect(copied).toEqual(["hello"]);
    expect(app.lastFrame()).toContain("Copied 5 chars");
  });
});

describe("copy mode colours", () => {
  function rgb(color: { toInts(): number[] }) {
    return color.toInts().slice(0, 3).join(",");
  }
  it("draws tmux-style black-on-yellow selection and a distinct bold cursor", async () => {
    const { app, test } = await setup();
    for (const key of ["\r", "\u0002", "[", "g", "g", "l", "V"]) {
      app.stdin.write(key);
      await settle();
    }
    const spans = test.captureSpans().lines.flatMap((line) => line.spans);
    const selected = spans.find((span) => span.text.includes("llo alpha"));
    expect(selected && rgb(selected.bg)).toBe("255,215,0");
    expect(selected && rgb(selected.fg)).toBe("0,0,0");
    const cursor = spans.find(
      (span) =>
        span.text === "e" &&
        rgb(span.bg) !== "255,215,0" &&
        rgb(span.fg) === "0,0,0",
    );
    expect(cursor && rgb(cursor.bg)).toBe("255,255,255");
    expect((cursor?.attributes ?? 0) & 1).toBe(1);
  });
  it("falls back to reverse video with NO_COLOR", async () => {
    const { app, test } = await setup(agents, 24, false, { NO_COLOR: "1" });
    for (const key of ["\r", "\u0002", "[", "g", "g", "V"]) {
      app.stdin.write(key);
      await settle();
    }
    const spans = test.captureSpans().lines.flatMap((line) => line.spans);
    const selected = spans.find((span) => span.text.includes("ello alpha"));
    expect((selected?.attributes ?? 0) & 32).toBe(32);
  });
});

describe("system clipboard", () => {
  it("copies yanks and mouse selections to the local clipboard even without OSC 52", async () => {
    const written: string[] = [];
    const { app, test } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {
        clipboard: { copyToClipboardOSC52: () => false },
        systemClipboard: {
          async write(text) {
            written.push(text);
            return { ok: true };
          },
        },
      },
    );
    for (const key of ["\r", "\u0002", "[", "g", "g", "V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(written).toEqual(["hello alpha"]);
    expect(app.lastFrame()).toContain("Copied 11 chars");
    const lines = app.lastFrame().split("\n");
    const row = lines.findIndex((line) => line.includes("hello alpha"));
    const col = lines[row]?.indexOf("hello alpha") ?? 0;
    await test.mockMouse.drag(col, row, col + 4, row);
    await settle();
    expect(written).toEqual(["hello alpha", "hello"]);
  });
  it("shows the native clipboard error when nothing could copy", async () => {
    const { app } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {
        clipboard: { copyToClipboardOSC52: () => false },
        systemClipboard: {
          write: async () => ({
            ok: false,
            error:
              "no clipboard tool found: install xclip, xsel or wl-clipboard",
          }),
        },
      },
    );
    for (const key of ["\r", "\u0002", "[", "V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("no clipboard tool found: install xclip");
  });
});
