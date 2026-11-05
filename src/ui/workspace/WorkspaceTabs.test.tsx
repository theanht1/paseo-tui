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
import { WorkspaceTabs } from "./WorkspaceTabs.js";
import type { WorkspaceTab } from "./workspaces.js";

it("closes the clicked tab without selecting it", async () => {
  const test = await createTestRenderer({ width: 60, height: 5 });
  const theme = createTheme({ NO_COLOR: "1" });
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const selected: string[] = [];
  const closed: string[] = [];
  const tab: WorkspaceTab = {
    kind: "terminal",
    key: "terminal:t",
    terminal: { id: "t", name: "Shell", workspaceId: "w", cwd: "/repo" },
  };
  try {
    flushSync(() =>
      createRoot(test.renderer).render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <WorkspaceTabs
            tabs={[
              {
                kind: "agent",
                key: "agent:a",
                agent: agent("a", { title: "Agent" }),
              },
              tab,
            ]}
            indicators={new Map()}
            selected="agent:a"
            onSelect={(value) => selected.push(value.key)}
            onClose={(value) => closed.push(value.key)}
          />
        </ThemeContext>,
      ),
    );
    const frame = await test.waitForFrame((frame) => frame.includes("Shell"));
    const closeColumn = at(frame.split("\n"), 0).lastIndexOf("×");
    expect(closeColumn).toBeGreaterThan(0);
    await test.mockMouse.click(closeColumn, 0);
    expect(closed).toEqual(["terminal:t"]);
    expect(selected).toEqual([]);
    await test.mockMouse.click(1, 0);
    expect(selected).toEqual(["agent:a"]);
  } finally {
    syntaxStyle.destroy();
    await test.dispose();
  }
});
