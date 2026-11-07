import stringWidth from "fast-string-width";
import { describe, expect, it } from "vitest";
import {
  fitToWidth,
  stripLayout,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
  tabKindIcon,
  tabNameWidth,
} from "./tab-layout.js";

describe("stripLayout", () => {
  it("splits the strip evenly between tabs", () => {
    expect(stripLayout(100, 4)).toEqual({ tabWidth: 25, overflow: false });
    expect(stripLayout(70, 3)).toEqual({ tabWidth: 23, overflow: false });
  });

  it("caps a tab at the maximum width when few tabs share a wide strip", () => {
    expect(stripLayout(200, 1)).toEqual({
      tabWidth: TAB_MAX_WIDTH,
      overflow: false,
    });
    expect(stripLayout(100, 3)).toEqual({
      tabWidth: TAB_MAX_WIDTH,
      overflow: false,
    });
  });

  it("uses the minimum width and overflows when tabs no longer fit", () => {
    expect(stripLayout(60, 5)).toEqual({
      tabWidth: TAB_MIN_WIDTH,
      overflow: false,
    });
    expect(stripLayout(60, 6)).toEqual({
      tabWidth: TAB_MIN_WIDTH,
      overflow: true,
    });
    expect(stripLayout(8, 1)).toEqual({
      tabWidth: TAB_MIN_WIDTH,
      overflow: true,
    });
  });
});

describe("tabNameWidth", () => {
  it("leaves room for the bar, glyph, icon and close slots", () => {
    expect(tabNameWidth(TAB_MIN_WIDTH)).toBe(4);
    expect(tabNameWidth(TAB_MAX_WIDTH)).toBe(24);
  });
});

describe("fitToWidth", () => {
  it("pads short names to the slot width", () => {
    expect(fitToWidth("Shell", 8)).toBe("Shell   ");
  });

  it("keeps a name that exactly fills the slot", () => {
    expect(fitToWidth("Shell", 5)).toBe("Shell");
  });

  it("truncates long names with an ellipsis", () => {
    expect(fitToWidth("Refactor parser", 8)).toBe("Refacto…");
  });

  it("drops whitespace left before the ellipsis", () => {
    expect(fitToWidth("A very long name", 8)).toBe("A very… ");
  });

  it("measures wide characters by display width", () => {
    const fitted = fitToWidth("日本語のエージェント", 8);
    expect(fitted).toBe("日本語… ");
    expect(stringWidth(fitted)).toBe(8);
  });

  it("never splits an emoji sequence", () => {
    const fitted = fitToWidth("👨‍👩‍👧 family agent", 4);
    expect(fitted).toBe("👨‍👩‍👧… ");
    expect(stringWidth(fitted)).toBe(4);
  });
});

describe("tabKindIcon", () => {
  it("gives every tab kind a distinct icon", () => {
    const icons = [
      tabKindIcon("agent"),
      tabKindIcon("terminal"),
      tabKindIcon("subagent"),
    ];
    expect(icons.slice(1)).toEqual(["▣", "◆"]);
    expect(new Set(icons).size).toBe(3);
    for (const icon of icons) expect(stringWidth(icon)).toBe(1);
  });
});
