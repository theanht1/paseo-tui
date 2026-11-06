import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import { agents, settle, settleUntil, setup } from "../test/app-harness.js";
import { createTheme } from "./render/theme.js";

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

describe("copy mode and clipboard", () => {
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

describe("copy mode over the whole chat", () => {
  function longChat(): AgentTimelineItem[] {
    return [
      { type: "user_message", text: "ancient first prompt" },
      ...Array.from(
        { length: 120 },
        (_, index): AgentTimelineItem => ({
          type: "user_message",
          text: `message ${index}`,
        }),
      ),
      { type: "reasoning", text: "secret line one\nsecret line two" },
      { type: "user_message", text: "latest prompt" },
    ];
  }
  async function enterCopy(app: Awaited<ReturnType<typeof setup>>["app"]) {
    for (const key of ["\r", "\u0002", "["]) {
      app.stdin.write(key);
      await settle();
    }
  }
  it("pages older history in as the cursor climbs past what is loaded, and keeps blocks collapsed", async () => {
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
      () => longChat(),
      () => ({ tail: 20, search: false }),
    );
    await enterCopy(app);
    expect(app.lastFrame()).toContain("COPY");
    expect(app.lastFrame()).toContain("∴ thinking · 2 lines");
    expect(app.lastFrame()).not.toContain("secret line one");
    for (let page = 0; page < 6; page++) {
      app.stdin.write("g");
      app.stdin.write("g");
      await settle();
    }
    await settleUntil(app.lastFrame, "ancient first prompt");
    for (const key of ["V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(copied).toEqual(["ancient first prompt"]);
  });
  it("moves with h j k l and pages with d and u", async () => {
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
      () =>
        Array.from(
          { length: 40 },
          (_, index): AgentTimelineItem => ({
            type: "user_message",
            text: `row ${index}`,
          }),
        ),
    );
    await enterCopy(app);
    for (const key of [
      "u",
      "u",
      "d",
      "d",
      "k",
      "k",
      "l",
      "l",
      "h",
      "v",
      "l",
      "y",
    ]) {
      app.stdin.write(key);
      await settle();
    }
    expect(copied).toEqual(["ow"]);
  });
  it("searches with ? and jumps paragraphs with { from real key input", async () => {
    const { copied, writer } = clipboard();
    const rows = Array.from(
      { length: 40 },
      (_, index): AgentTimelineItem => ({
        type: "user_message",
        text: `row ${index}`,
      }),
    );
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
      () => rows,
    );
    await enterCopy(app);
    for (const key of ["?", "r", "o", "w", " ", "1", "2"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(app.lastFrame()).toContain("?row 12▌");
    for (const key of ["\r", "V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(copied).toEqual(["row 12"]);
    await enterCopy(app);
    for (const key of ["{", "k", "V", "y"]) {
      app.stdin.write(key);
      await settle();
    }
    expect(copied).toEqual(["row 12", "row 38"]);
  });
  it("scrolls with the mouse wheel and pages older history in at the top", async () => {
    const { app, test } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      () => [
        { type: "user_message", text: "ancient first prompt" },
        ...Array.from(
          { length: 60 },
          (_, index): AgentTimelineItem => ({
            type: "user_message",
            text: `message ${index}`,
          }),
        ),
      ],
      () => ({ tail: 20, search: false }),
    );
    await enterCopy(app);
    const view = test.renderer.root.findDescendantById("copy-mode");
    if (!view) throw Error("Missing copy view");
    expect(app.lastFrame()).toContain("message 59");
    await test.mockMouse.scroll(view.x + 2, view.y + 2, "up");
    await settle();
    expect(app.lastFrame()).not.toContain("message 59");
    expect(app.lastFrame()).toContain("COPY");
    for (let tick = 0; tick < 60; tick++)
      await test.mockMouse.scroll(view.x + 2, view.y + 2, "up");
    await settleUntil(app.lastFrame, "ancient first prompt");
  });
  it("draws copy-mode text in the timeline's colors", async () => {
    const { app, test } = await setup(
      agents,
      24,
      false,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      () => [
        { type: "user_message", text: "hello alpha" },
        {
          type: "tool_call",
          callId: "c1",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "npm test" },
        },
        { type: "assistant_message", text: "Ran `npm test`." },
      ],
    );
    await enterCopy(app);
    expect(app.lastFrame()).toContain("COPY");
    const theme = createTheme({});
    const spans = test.captureSpans().lines.flatMap((line) => line.spans);
    const color = (text: string) =>
      spans
        .find((span) => span.text.includes(text))
        ?.fg.toInts()
        .slice(0, 3)
        .join(",");
    const hex = (value: string) =>
      [1, 3, 5]
        .map((at) => Number.parseInt(value.slice(at, at + 2), 16))
        .join(",");
    expect(color("✓ Bash npm test")).toBe(hex(theme.success));
    expect(color("hello alpha")).toBe(hex(theme.user));
    expect(color("npm test`")).toBeUndefined();
    expect(
      spans.some(
        (span) =>
          span.text === "npm test" &&
          span.fg.toInts().slice(0, 3).join(",") === hex(theme.tool),
      ),
    ).toBe(true);
  });
});
