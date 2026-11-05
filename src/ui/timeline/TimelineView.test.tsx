import { RGBA, TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { UserMessage } from "./TimelineView.js";

it.each([{}, { NO_COLOR: "1" }])(
  "labels human messages and preserves their text with theme %j",
  async (env) => {
    const test = await createTestRenderer({ width: 50, height: 8 });
    const theme = createTheme(env);
    const syntaxStyle = createSyntaxStyle(test.renderer, theme);
    const root = createRoot(test.renderer);
    try {
      flushSync(() =>
        root.render(
          <ThemeContext value={{ theme, syntaxStyle }}>
            <UserMessage text={"Please fix this\nand keep the details"} />
          </ThemeContext>,
        ),
      );
      await test.waitForVisualIdle();
      const frame = test.captureCharFrame();
      expect(frame).toContain("You");
      expect(frame).toContain("Please fix this");
      expect(frame).toContain("and keep the details");
      if (!env.NO_COLOR) {
        const spans = test.captureSpans().lines.flatMap((line) => line.spans);
        const label = spans.find((span) => span.text.includes("You"));
        expect(label?.bg).toEqual(RGBA.fromHex(theme.userBg));
        const body = spans.find((span) =>
          span.text.includes("Please fix this"),
        );
        expect(body?.fg).toEqual(RGBA.fromHex(theme.user));
        expect((body?.attributes ?? 0) & TextAttributes.BOLD).toBeTruthy();
      }
    } finally {
      await test.dispose();
      syntaxStyle.destroy();
    }
  },
);
