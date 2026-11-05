import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import { at } from "../../test/at.js";
import { agent } from "../../test/fixtures.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { CloseTabConfirm } from "./CloseTabConfirm.js";
import type { WorkspaceTab } from "./workspaces.js";

it.each(["agent", "terminal"] as const)(
  "explains %s close and supports mouse confirmation and cancellation",
  async (kind) => {
    const test = await createTestRenderer({ width: 80, height: 20 });
    const theme = createTheme({ NO_COLOR: "1" });
    const syntaxStyle = createSyntaxStyle(test.renderer, theme);
    const events: string[] = [];
    const tab: WorkspaceTab =
      kind === "agent"
        ? { kind, key: "agent:a", agent: agent("a", { title: "My agent" }) }
        : {
            kind,
            key: "terminal:t",
            terminal: {
              id: "t",
              name: "My shell",
              workspaceId: "w",
              cwd: "/repo",
            },
          };
    try {
      flushSync(() =>
        createRoot(test.renderer).render(
          <ThemeContext value={{ theme, syntaxStyle }}>
            <CloseTabConfirm
              tab={tab}
              onConfirm={() => events.push("confirm")}
              onCancel={() => events.push("cancel")}
            />
          </ThemeContext>,
        ),
      );
      const frame = await test.waitForFrame((frame) =>
        frame.includes("Confirm"),
      );
      expect(frame).toContain(kind === "agent" ? "Archive" : "Kill");
      expect(frame).toContain(kind === "agent" ? "My agent" : "My shell");
      const lines = frame.split("\n");
      const row = lines.findIndex((line) => line.includes("Confirm"));
      await test.mockMouse.click(at(lines, row).indexOf("Confirm"), row);
      await test.mockMouse.click(at(lines, row).indexOf("Cancel"), row);
      expect(events).toEqual(["confirm", "cancel"]);
      test.mockInput.pressKey("y");
      test.mockInput.pressKey("n");
      test.mockInput.pressEscape();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toEqual([
        "confirm",
        "cancel",
        "confirm",
        "cancel",
        "cancel",
      ]);
    } finally {
      syntaxStyle.destroy();
      await test.dispose();
    }
  },
);
