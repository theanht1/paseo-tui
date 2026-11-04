import { darkHighlightColors, type HighlightStyle } from "@getpaseo/highlight";
import {
  type CliRenderer,
  type ColorInput,
  RGBA,
  type ScrollBoxOptions,
  type StyleDefinitionInput,
  SyntaxStyle,
} from "@opentui/core";
import { createContext } from "react";

export interface Theme {
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  user: string;
  assistant: string;
  tool: string;
  reasoning: string;
  error: string;
  warn: string;
  success: string;
  border: string;
  borderFocused: string;
  selectionBg: string;
  codeBg: string;
  status: Record<"running" | "idle" | "error" | "attention", string>;
  syntax: Record<HighlightStyle, string>;
  heading: [string, string, string];
}

export function colorProp(color: string): string | undefined {
  return color || undefined;
}

export function foregroundProp(color: string): ColorInput {
  return color || RGBA.defaultForeground();
}

export function backgroundProp(color: string): ColorInput {
  return color || RGBA.defaultBackground();
}

export function scrollbarOptions(
  theme: Theme,
): ScrollBoxOptions["scrollbarOptions"] {
  return {
    visible: Boolean(theme.border),
    trackOptions: {
      backgroundColor: backgroundProp(theme.border),
      foregroundColor: foregroundProp(theme.faint),
    },
  };
}

export function createTheme(env: NodeJS.ProcessEnv): Theme {
  function color(value: string): string {
    return env.NO_COLOR ? "" : value;
  }
  return {
    fg: color("#d4d4d4"),
    muted: color("#9a9a9a"),
    faint: color("#707070"),
    accent: color("#82aaff"),
    user: color("#82aaff"),
    assistant: color("#d4d4d4"),
    tool: color("#89ddff"),
    reasoning: color("#b0a0c0"),
    error: color("#f07178"),
    warn: color("#ffcb6b"),
    success: color("#c3e88d"),
    border: color("#454545"),
    borderFocused: color("#82aaff"),
    selectionBg: color("#283142"),
    codeBg: color("#20242c"),
    status: {
      running: color("#82aaff"),
      idle: color("#c3e88d"),
      error: color("#f07178"),
      attention: color("#ffcb6b"),
    },
    syntax: {
      ...darkHighlightColors,
      ...Object.fromEntries(
        Object.entries(darkHighlightColors).map(([key, value]) => [
          key,
          color(value),
        ]),
      ),
    },
    heading: [color("#82aaff"), color("#89ddff"), color("#c3e88d")],
  };
}

export interface ThemeContextValue {
  theme: Theme;
  syntaxStyle: SyntaxStyle;
}
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function createSyntaxStyle(
  renderer: CliRenderer,
  theme: Theme,
): SyntaxStyle {
  function style(
    color: string,
    extra: StyleDefinitionInput = {},
  ): StyleDefinitionInput {
    return {
      ...extra,
      fg: color ? RGBA.fromHex(color) : RGBA.defaultForeground(),
    };
  }
  return SyntaxStyle.fromStyles(
    {
      default: style(theme.fg),
      "markup.heading": style(theme.heading[0], { bold: true }),
      "markup.heading.1": style(theme.heading[0], { bold: true }),
      "markup.heading.2": style(theme.heading[1], { bold: true }),
      "markup.heading.3": style(theme.heading[2], { bold: true }),
      "markup.strong": style(theme.fg, { bold: true }),
      "markup.italic": style(theme.fg, { italic: true }),
      "markup.raw": style(theme.tool),
      "markup.link": style(theme.accent, { underline: true }),
      "punctuation.special": style(theme.faint),
      conceal: style(theme.faint),
    },
    renderer.nativeScene,
  );
}
