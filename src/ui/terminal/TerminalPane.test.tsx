import type {
  PaseoTerminalHandle,
  TerminalStreamEvent,
} from "@getpaseo/client";
import { EmbeddedTerminalRenderable, TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import type { TerminalStreamPort } from "../../connection/ports.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { TerminalPane } from "./TerminalPane.js";

it("renders streamed VT colors and cursor positioning and forwards control keys", async () => {
  const test = await createTestRenderer({
    width: 40,
    height: 10,
    exitOnCtrlC: false,
  });
  const theme = createTheme({});
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  let receive: (event: TerminalStreamEvent) => void = () => {};
  const input: string[] = [];
  const lifecycle: unknown[] = [];
  const stream: TerminalStreamPort = {
    observe(_id, handler) {
      lifecycle.push("observe");
      receive = handler;
      return { ready: Promise.resolve(), async close() {} };
    },
    write(_id, data) {
      input.push(data);
    },
    resize(_id, cols, rows) {
      lifecycle.push([cols, rows]);
    },
  };
  const terminal: PaseoTerminalHandle = {
    id: "t",
    current: () => null,
    refresh: async () => null,
    write: () => 0,
    sendKeys: () => 0,
    kill: async () => {},
    capture: async () => ({
      terminalId: "t",
      lines: ["polling loses colors"],
      totalLines: 1,
      requestId: "r",
    }),
  };
  try {
    flushSync(() =>
      root.render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <TerminalPane
            terminal={terminal}
            stream={stream}
            focused
            paneFocused
            onFocus={() => {}}
          />
        </ThemeContext>,
      ),
    );
    await test.renderOnce();
    expect(lifecycle).toEqual(["observe", [38, 7]]);
    const replay = {
      terminalId: "t",
      subscriptionId: "s",
      type: "replay" as const,
    };
    receive({ ...replay, replay: { type: "begin", cols: 8, rows: 3 } });
    receive({
      ...replay,
      replay: {
        type: "data",
        data: new TextEncoder().encode("abcdefghX\x1b[2;1H!"),
      },
    });
    receive({ ...replay, replay: { type: "end" } });
    await test.renderOnce();
    expect(test.captureCharFrame()).not.toContain("abcdefghX");
    expect(test.captureCharFrame()).toContain("abcdefgh!");
    expect(lifecycle).toEqual(["observe", [38, 7], [38, 7]]);
    receive({ ...replay, replay: { type: "begin", cols: 38, rows: 7 } });
    receive({ ...replay, replay: { type: "end" } });

    receive({
      terminalId: "t",
      subscriptionId: "s",
      type: "output",
      data: new TextEncoder().encode("\x1b[31mRED\x1b[0m\r\nhello\x1b[2;2HX"),
    });
    await test.renderOnce();
    expect(test.captureCharFrame()).toContain("hXllo");
    const red = test
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("RED"));
    expect(red?.fg.r).toBeGreaterThan(red?.fg.g ?? 1);
    expect(test.captureSpans().cursor).toEqual([4, 3]);
    receive({
      terminalId: "t",
      subscriptionId: "s",
      type: "output",
      data: new TextEncoder().encode(
        "\x1b[3;1H\x1b[1;38;2;12;34;56;48;5;196mRGB\x1b[0m\x1b[38;5;46mINDEX\x1b[0m\x1b[?25l",
      ),
    });
    await test.renderOnce();
    const styled = test.captureSpans().lines.flatMap((line) => line.spans);
    const rgb = styled.find((span) => span.text.includes("RGB"));
    const indexed = styled.find((span) => span.text.includes("INDEX"));
    expect(rgb?.fg.toInts().slice(0, 3)).toEqual([12, 34, 56]);
    expect(rgb?.bg.toInts().slice(0, 3)).toEqual([255, 0, 0]);
    expect((rgb?.attributes ?? 0) & TextAttributes.BOLD).toBe(
      TextAttributes.BOLD,
    );
    expect(indexed?.fg.toInts().slice(0, 3)).toEqual([0, 255, 0]);
    const surface = test.renderer.root.findDescendantById("terminal-surface");
    if (!(surface instanceof EmbeddedTerminalRenderable))
      throw Error("Missing terminal surface");
    expect(surface.screen().cursor.visible).toBe(false);
    receive({
      terminalId: "t",
      subscriptionId: "s",
      type: "output",
      data: new TextEncoder().encode("\x1b[?25h"),
    });
    await test.renderOnce();
    expect(surface.screen().cursor.visible).toBe(true);
    for (const key of ["\x1b", "\x03", "\x0e", "\x0b"]) {
      test.mockInput.pressKey(key);
      await test.renderOnce();
      await expect.poll(() => input.join("")).toContain(key);
    }
    expect(input).toEqual(["\x1b", "\x03", "\x0e", "\x0b"]);
    test.mockInput.pressKey("\x1d");
    await test.renderOnce();
    expect(input).toHaveLength(4);
    receive({
      terminalId: "t",
      subscriptionId: "s",
      type: "output",
      data: new TextEncoder().encode("\x1b[?2004h"),
    });
    await test.mockInput.pasteBracketedText("a\nb");
    expect(input.at(-1)).toBe("\x1b[200~a\nb\x1b[201~");
    flushSync(() =>
      root.render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <TerminalPane
            terminal={terminal}
            stream={stream}
            focused={false}
            paneFocused
            onFocus={() => {}}
          />
        </ThemeContext>,
      ),
    );
    const count = input.length;
    test.mockInput.pressKey("j");
    await test.renderOnce();
    expect(input).toHaveLength(count);
  } finally {
    await test.dispose();
    syntaxStyle.destroy();
  }
});

it("replays a larger saved screen into a smaller pane, keeping the cursor row and deferring pane resizes", async () => {
  const test = await createTestRenderer({
    width: 40,
    height: 10,
    exitOnCtrlC: false,
  });
  const theme = createTheme({});
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  let receive: (event: TerminalStreamEvent) => void = () => {};
  const sizes: number[][] = [];
  const stream: TerminalStreamPort = {
    observe(_id, handler) {
      receive = handler;
      return { ready: Promise.resolve(), async close() {} };
    },
    write() {},
    resize(_id, cols, rows) {
      sizes.push([cols, rows]);
    },
  };
  const terminal: PaseoTerminalHandle = {
    id: "t",
    current: () => null,
    refresh: async () => null,
    write: () => 0,
    sendKeys: () => 0,
    kill: async () => {},
    capture: async () => ({
      terminalId: "t",
      lines: [],
      totalLines: 0,
      requestId: "r",
    }),
  };
  try {
    flushSync(() =>
      root.render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <TerminalPane
            terminal={terminal}
            stream={stream}
            focused
            paneFocused
            onFocus={() => {}}
          />
        </ThemeContext>,
      ),
    );
    await test.renderOnce();
    expect(sizes).toEqual([[38, 7]]);
    const replay = {
      terminalId: "t",
      subscriptionId: "s",
      type: "replay" as const,
    };
    receive({ ...replay, replay: { type: "begin", cols: 80, rows: 24 } });
    receive({
      ...replay,
      replay: {
        type: "data",
        data: new TextEncoder().encode(
          "top line\x1b[23;1Hsecond last\x1b[24;1H$ prompt",
        ),
      },
    });
    test.resize(44, 12);
    await test.renderOnce();
    expect(sizes).toEqual([[38, 7]]);
    receive({ ...replay, replay: { type: "end" } });
    await test.renderOnce();
    expect(sizes).toEqual([
      [38, 7],
      [42, 9],
    ]);
    const frame = test.captureCharFrame();
    expect(frame).toContain("$ prompt");
    expect(frame).toContain("second last");
    expect(frame).not.toContain("top line");
    const surface = test.renderer.root.findDescendantById("terminal-surface");
    if (!(surface instanceof EmbeddedTerminalRenderable))
      throw Error("Missing terminal surface");
    expect(surface.screen().cursor.visible).toBe(true);
    const cursor = test.captureSpans().cursor;
    const rows = frame.split("\n");
    const promptRow = rows.findIndex((line) => line.includes("$ prompt"));
    const promptColumn = rows[promptRow]?.indexOf("$ prompt") ?? -1;
    expect(cursor).toEqual([
      promptColumn + "$ prompt".length + 1,
      promptRow + 1,
    ]);
  } finally {
    await test.dispose();
    syntaxStyle.destroy();
  }
});
