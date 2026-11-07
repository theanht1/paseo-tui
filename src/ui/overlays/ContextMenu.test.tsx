import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, it } from "vitest";
import { at } from "../../test/at.js";
import { createKeyRouter, KeyRouterContext } from "../input/key-router.js";
import type { Stroke } from "../input/keymap.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "../render/theme.js";
import { ContextMenu } from "./ContextMenu.js";
import type { MenuItem } from "./context-menu-items.js";

function stroke(name: string, sequence = name): Stroke {
  return {
    name,
    sequence,
    ctrl: false,
    meta: false,
    shift: false,
    super: false,
  };
}
async function mount() {
  const test = await createTestRenderer({ width: 60, height: 20 });
  const theme = createTheme({ NO_COLOR: "1" });
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const events: string[] = [];
  const router = createKeyRouter();
  const item = (id: string, title: string, shortcut: string): MenuItem => ({
    id,
    title,
    shortcut,
    tone: id === "archive" ? "danger" : "normal",
    run: () => events.push(id),
  });
  flushSync(() =>
    createRoot(test.renderer).render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <KeyRouterContext value={router}>
          <ContextMenu
            x={3}
            y={2}
            items={[
              item("rename", "Rename", "r"),
              item("labels", "Labels…", "l"),
              item("archive", "Archive workspace", "a"),
            ]}
            onClose={() => events.push("close")}
          />
        </KeyRouterContext>
      </ThemeContext>,
    ),
  );
  const frame = await test.waitForFrame((frame) => frame.includes("Rename"));
  return {
    test,
    frame,
    events,
    press: async (...strokes: Stroke[]) => {
      for (const next of strokes) {
        router.route(next);
        await test.renderOnce();
      }
    },
    dispose: async () => {
      syntaxStyle.destroy();
      await test.dispose();
    },
  };
}

it("offers each action as a separate clickable row", async () => {
  const menu = await mount();
  try {
    expect(menu.frame).toContain("Labels…");
    const lines = menu.frame.split("\n");
    const row = lines.findIndex((line) => line.includes("Archive workspace"));
    await menu.test.mockMouse.click(at(lines, row).indexOf("Archive"), row);
    expect(menu.events).toEqual(["archive"]);
  } finally {
    await menu.dispose();
  }
});

it("moves with j/k and runs the row under the cursor on Enter", async () => {
  const menu = await mount();
  try {
    await menu.press(stroke("return"));
    await menu.press(stroke("j", "j"), stroke("j", "j"), stroke("k", "k"));
    await menu.press(stroke("return"));
    expect(menu.events).toEqual(["rename", "labels"]);
  } finally {
    await menu.dispose();
  }
});

it("runs a row by its shortcut letter and closes on Esc or q", async () => {
  const menu = await mount();
  try {
    await menu.press(stroke("l", "l"), stroke("a", "a"), stroke("r", "r"));
    await menu.press(stroke("escape", "\u001b"), stroke("q", "q"));
    expect(menu.events).toEqual([
      "labels",
      "archive",
      "rename",
      "close",
      "close",
    ]);
  } finally {
    await menu.dispose();
  }
});
