import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { createKeyRouter, KeyRouterContext } from "../input/key-router.js";
import type { Stroke } from "../input/keymap.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { SubagentPopup } from "./SubagentPopup.js";
import {
  paneSubagents,
  popupRows,
  type SubagentPopupRow,
} from "./subagent-popup.js";

function stroke(name: string, extra: Partial<Stroke> = {}): Stroke {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name,
    ...extra,
  };
}
const parent = agent("parent", {});
const rows: SubagentPopupRow[] = popupRows(
  paneSubagents(
    parent,
    null,
    [
      parent,
      ...Array.from({ length: 30 }, (_, index) =>
        agent(`child-${index}`, {
          title: `Child ${String(index).padStart(2, "0")}`,
          labels: { "paseo.parent-agent-id": "parent" },
        }),
      ),
    ],
    [],
  ),
);

async function mountPopup() {
  const test = await createTestRenderer({ width: 70, height: 16 });
  const theme = createTheme({ NO_COLOR: "1" });
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const router = createKeyRouter();
  const selected: string[] = [];
  flushSync(() =>
    createRoot(test.renderer).render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <KeyRouterContext value={router}>
          <SubagentPopup
            rows={rows}
            onSelect={(row) => selected.push(row.label)}
            onClose={() => {}}
          />
        </KeyRouterContext>
      </ThemeContext>,
    ),
  );
  await test.waitForFrame((frame) => frame.includes("Child 00"));
  async function press(next: Stroke) {
    router.route(next);
    await test.renderOnce();
  }
  return {
    test,
    press,
    selected,
    async dispose() {
      syntaxStyle.destroy();
      await test.dispose();
    },
  };
}
function cursorLine(frame: string) {
  return frame.split("\n").find((line) => line.includes("›")) ?? "";
}

it("moves the cursor with vim list keys and scrolls the window with it", async () => {
  const popup = await mountPopup();
  try {
    await popup.press(stroke("G", { shift: true }));
    expect(cursorLine(popup.test.captureCharFrame())).toContain("Child 29");
    await popup.press(stroke("g"));
    await popup.press(stroke("g"));
    expect(cursorLine(popup.test.captureCharFrame())).toContain("Child 00");
    await popup.press(stroke("d", { ctrl: true }));
    expect(cursorLine(popup.test.captureCharFrame())).toContain("Child 07");
    await popup.press(stroke("u", { ctrl: true }));
    await popup.press(stroke("j"));
    expect(cursorLine(popup.test.captureCharFrame())).toContain("Child 01");
    await popup.press(stroke("return"));
    expect(popup.selected).toEqual(["Child 01"]);
  } finally {
    await popup.dispose();
  }
});
