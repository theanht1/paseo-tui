import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import { Markdown } from "./markdown.js";
import { createSyntaxStyle, createTheme, ThemeContext } from "./theme.js";

it("renders streaming markdown, highlighted Python, and appended text", async () => {
  const test = await createTestRenderer({ width: 60, height: 20 });
  const theme = createTheme({});
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  const text =
    '# Heading\n\n- **item**\n\n| Name | Value |\n| --- | --- |\n| cell | result |\n\n```python\ndef greet():\n    return "hello"\n```\n';
  function render(content: string) {
    flushSync(() =>
      root.render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <Markdown text={content} streaming />
        </ThemeContext>,
      ),
    );
  }
  try {
    render(text);
    await test.waitForFrame((frame) => frame.includes("hello"));
    const frame = test.captureCharFrame();
    for (const word of ["Heading", "item", "cell", "result", "python"])
      expect(frame).toContain(word);
    expect(frame).toMatch(/[•●▪-] item/);
    for (const marker of ["#", "**", "`", "| ---"])
      expect(frame).not.toContain(marker);
    const codeLines = test
      .captureSpans()
      .lines.filter((line) =>
        /def |return /.test(line.spans.map((span) => span.text).join("")),
      );
    const colors = new Set(
      codeLines.flatMap((line) =>
        line.spans
          .filter((span) => span.text.trim())
          .map((span) => span.fg.toString()),
      ),
    );
    expect(colors.size).toBeGreaterThanOrEqual(2);
    render(`${text}\nAppended reply`);
    await test.waitForFrame((frame) => frame.includes("Appended reply"));
  } finally {
    await test.dispose();
    syntaxStyle.destroy();
  }
});
