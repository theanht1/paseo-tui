import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import { at } from "../../test/at.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { ContextMenu } from "./ContextMenu.js";

it("offers workspace archive as a separate clickable menu action", async () => {
  const test = await createTestRenderer({ width: 60, height: 20 });
  const theme = createTheme({ NO_COLOR: "1" });
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const events: string[] = [];
  try {
    flushSync(() =>
      createRoot(test.renderer).render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <ContextMenu
            x={3}
            y={2}
            onRename={() => events.push("rename")}
            onArchive={() => events.push("archive")}
            onClose={() => events.push("close")}
          />
        </ThemeContext>,
      ),
    );
    const frame = await test.waitForFrame((frame) => frame.includes("Rename"));
    expect(frame).toContain("Archive workspace");
    const lines = frame.split("\n");
    const row = lines.findIndex((line) => line.includes("Archive workspace"));
    await test.mockMouse.click(at(lines, row).indexOf("Archive"), row);
    expect(events).toEqual(["archive"]);
  } finally {
    syntaxStyle.destroy();
    await test.dispose();
  }
});
