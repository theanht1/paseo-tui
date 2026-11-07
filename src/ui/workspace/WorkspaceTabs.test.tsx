import type { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import type { ComponentProps } from "react";
import { expect, it } from "vitest";
import { at } from "../../test/at.js";
import { agent } from "../../test/fixtures.js";
import {
  createSyntaxStyle,
  createTheme,
  type Theme,
  ThemeContext,
} from "../render/theme.js";
import { WorkspaceTabs } from "./WorkspaceTabs.js";
import type { WorkspaceTab } from "./workspaces.js";

type Props = ComponentProps<typeof WorkspaceTabs>;

function terminalTab(id: string, name: string): WorkspaceTab {
  return {
    kind: "terminal",
    key: `terminal:${id}`,
    terminal: { id, name, workspaceId: "w", cwd: "/repo" },
  };
}
const agentTab: WorkspaceTab = {
  kind: "agent",
  key: "agent:a",
  agent: agent("a", { title: "Agent" }),
};

async function renderTabs(
  props: Partial<Props> & Pick<Props, "tabs">,
  theme: Theme = createTheme({}),
) {
  const test = await createTestRenderer({ width: 80, height: 3 });
  const syntaxStyle = createSyntaxStyle(test.renderer, theme);
  const root = createRoot(test.renderer);
  function render(next: Partial<Props> = {}) {
    flushSync(() =>
      root.render(
        <ThemeContext value={{ theme, syntaxStyle }}>
          <WorkspaceTabs
            width={63}
            indicators={new Map()}
            selected={null}
            onSelect={() => {}}
            {...props}
            {...next}
          />
        </ThemeContext>,
      ),
    );
  }
  render();
  await test.renderOnce();
  function box(key: string) {
    const found = test.renderer.root.findDescendantById(`tab:${key}`);
    if (!found) throw Error(`Missing tab ${key}`);
    return found;
  }
  function row(key: string): string {
    const tab = box(key);
    return at(test.captureCharFrame().split("\n"), tab.y).slice(
      tab.x,
      tab.x + tab.width,
    );
  }
  function spanAt(x: number) {
    let column = 0;
    for (const span of at(test.captureSpans().lines, 0).spans) {
      if (x < column + span.width) return span;
      column += span.width;
    }
    throw Error(`No span at ${x}`);
  }
  return {
    test,
    render,
    box,
    row,
    spanAt,
    async dispose() {
      syntaxStyle.destroy();
      await test.dispose();
    },
  };
}

function hex(color: RGBA): string {
  return `#${color
    .toInts()
    .slice(0, 3)
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

it("closes the clicked tab without selecting it", async () => {
  const selected: string[] = [];
  const closed: string[] = [];
  const view = await renderTabs({
    tabs: [agentTab, terminalTab("t", "Shell")],
    selected: "agent:a",
    onSelect: (value) => selected.push(value.key),
    onClose: (value) => closed.push(value.key),
  });
  try {
    const frame = await view.test.waitForFrame((frame) =>
      frame.includes("Shell"),
    );
    const closeColumn = at(frame.split("\n"), 0).lastIndexOf("×");
    expect(closeColumn).toBeGreaterThan(0);
    await view.test.mockMouse.click(closeColumn, 0);
    expect(closed).toEqual(["terminal:t"]);
    expect(selected).toEqual([]);
    await view.test.mockMouse.click(1, 0);
    expect(selected).toEqual(["agent:a"]);
  } finally {
    await view.dispose();
  }
});

it("gives every tab the same width and re-flows when the strip resizes", async () => {
  const tabs = [agentTab, terminalTab("t", "Shell"), terminalTab("u", "Logs")];
  const view = await renderTabs({ tabs });
  try {
    expect(view.box("terminal:t").x - view.box("agent:a").x).toBe(20);
    expect(view.box("terminal:u").x - view.box("terminal:t").x).toBe(20);
    view.render({ width: 39 });
    await view.test.renderOnce();
    expect(view.box("terminal:t").x - view.box("agent:a").x).toBe(12);
    expect(view.box("terminal:u").x - view.box("terminal:t").x).toBe(12);
  } finally {
    await view.dispose();
  }
});

it("lays out status, kind icon, truncated name and close in fixed slots", async () => {
  const view = await renderTabs({
    tabs: [
      agentTab,
      terminalTab("t", "A very long terminal name that cannot fit"),
    ],
    indicators: new Map([
      ["terminal:t", { kind: "unread", reason: "finished" }],
    ]),
    onClose: () => {},
  });
  try {
    const terminal = view.row("terminal:t");
    expect(terminal).toBe(" ● ▣ A very long terminal…  ×");
    const agentRow = view.row("agent:a");
    expect(agentRow).toMatch(/^ {3}❯ Agent +×$/);
    expect(agentRow.length).toBe(terminal.length);
  } finally {
    await view.dispose();
  }
});

it("marks the selected tab with an accent bar, bold text and the active background", async () => {
  const theme = createTheme({});
  const view = await renderTabs(
    { tabs: [agentTab, terminalTab("t", "Shell")], selected: "agent:a" },
    theme,
  );
  try {
    expect(view.row("agent:a").startsWith("▎")).toBe(true);
    expect(view.row("terminal:t").startsWith(" ")).toBe(true);
    const agentX = view.box("agent:a").x;
    const terminalX = view.box("terminal:t").x;
    expect(hex(view.spanAt(agentX).fg)).toBe(theme.accent);
    const selectedName = view.spanAt(agentX + 5);
    expect(hex(selectedName.bg)).toBe(theme.tabActiveBg);
    expect(hex(selectedName.fg)).toBe(theme.tabActiveFg);
    expect(selectedName.attributes & 1).toBe(1);
    const otherName = view.spanAt(terminalX + 5);
    expect(hex(otherName.bg)).toBe(theme.tabBg);
    expect(otherName.attributes & 1).toBe(0);
    expect(hex(view.spanAt(terminalX - 1).bg)).toBe(theme.tabStripBg);
  } finally {
    await view.dispose();
  }
});

it("dims the strip of an unfocused pane", async () => {
  const theme = createTheme({});
  const view = await renderTabs(
    {
      tabs: [agentTab, terminalTab("t", "Shell")],
      selected: "agent:a",
      dimmed: true,
    },
    theme,
  );
  try {
    expect(view.row("agent:a").startsWith("▎")).toBe(true);
    const selectedName = view.spanAt(view.box("agent:a").x + 5);
    expect(hex(selectedName.bg)).toBe(theme.tabBg);
    expect(hex(selectedName.fg)).toBe(theme.muted);
    expect(hex(view.spanAt(view.box("terminal:t").x + 5).fg)).toBe(theme.faint);
  } finally {
    await view.dispose();
  }
});

it("keeps the selected tab in view when the tabs overflow the strip", async () => {
  const tabs = Array.from({ length: 10 }, (_, index) =>
    terminalTab(`t${index}`, `Shell ${index}`),
  );
  const view = await renderTabs({ tabs, selected: "terminal:t9" });
  try {
    expect(view.box("terminal:t1").x - view.box("terminal:t0").x).toBe(12);
    await view.test.renderOnce();
    const last = view.box("terminal:t9");
    expect(last.x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.width).toBeLessThanOrEqual(60);
    expect(view.row("terminal:t9")).toContain("She…");
  } finally {
    await view.dispose();
  }
});
