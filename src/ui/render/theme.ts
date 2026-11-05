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
  userBg: string;
  assistant: string;
  tool: string;
  reasoning: string;
  error: string;
  warn: string;
  success: string;
  border: string;
  borderFocused: string;
  selectionBg: string;
  cursorBg: string;
  cursorFg: string;
  codeBg: string;
  /** tmux `mode-style`: copy-mode selection and the copy cursor on top of it. */
  copySelectionBg: string;
  copySelectionFg: string;
  copyCursorBg: string;
  copyCursorFg: string;
  status: Record<
    "running" | "idle" | "error" | "attention" | "question",
    string
  >;
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

type ColorField = {
  [K in keyof Theme]: Theme[K] extends string ? K : never;
}[keyof Theme];
/** Top-level theme colors a config may override. */
export const THEME_COLOR_FIELDS: readonly ColorField[] = [
  "fg",
  "muted",
  "faint",
  "accent",
  "user",
  "userBg",
  "assistant",
  "tool",
  "reasoning",
  "error",
  "warn",
  "success",
  "border",
  "borderFocused",
  "selectionBg",
  "cursorBg",
  "cursorFg",
  "codeBg",
  "copySelectionBg",
  "copySelectionFg",
  "copyCursorBg",
  "copyCursorFg",
];
export const THEME_STATUS_FIELDS: readonly (keyof Theme["status"])[] = [
  "running",
  "idle",
  "error",
  "attention",
  "question",
];
export function isHighlightStyle(key: string): key is HighlightStyle {
  return Object.hasOwn(darkHighlightColors, key);
}
/** User colors merged over the defaults; `heading` replaces levels from the first. */
export type ThemeOverrides = Partial<Pick<Theme, ColorField>> & {
  status?: Partial<Theme["status"]>;
  syntax?: Partial<Theme["syntax"]>;
  heading?: readonly string[];
};

export function createTheme(
  env: NodeJS.ProcessEnv,
  overrides: ThemeOverrides = {},
): Theme {
  function color(value: string): string {
    return env.NO_COLOR ? "" : value;
  }
  return {
    fg: color(overrides.fg ?? "#d4d4d4"),
    muted: color(overrides.muted ?? "#9a9a9a"),
    faint: color(overrides.faint ?? "#707070"),
    accent: color(overrides.accent ?? "#82aaff"),
    user: color(overrides.user ?? "#c8dcff"),
    userBg: color(overrides.userBg ?? "#35496a"),
    assistant: color(overrides.assistant ?? "#d4d4d4"),
    tool: color(overrides.tool ?? "#89ddff"),
    reasoning: color(overrides.reasoning ?? "#b0a0c0"),
    error: color(overrides.error ?? "#f07178"),
    warn: color(overrides.warn ?? "#ffcb6b"),
    success: color(overrides.success ?? "#c3e88d"),
    border: color(overrides.border ?? "#454545"),
    borderFocused: color(overrides.borderFocused ?? "#82aaff"),
    selectionBg: color(overrides.selectionBg ?? "#283142"),
    cursorBg: color(overrides.cursorBg ?? "#82aaff"),
    cursorFg: color(overrides.cursorFg ?? "#101820"),
    codeBg: color(overrides.codeBg ?? "#20242c"),
    copySelectionBg: color(overrides.copySelectionBg ?? "#ffd700"),
    copySelectionFg: color(overrides.copySelectionFg ?? "#000000"),
    copyCursorBg: color(overrides.copyCursorBg ?? "#ffffff"),
    copyCursorFg: color(overrides.copyCursorFg ?? "#000000"),
    status: {
      running: color(overrides.status?.running ?? "#82aaff"),
      idle: color(overrides.status?.idle ?? "#c3e88d"),
      error: color(overrides.status?.error ?? "#f07178"),
      attention: color(overrides.status?.attention ?? "#ffcb6b"),
      question: color(overrides.status?.question ?? "#c792ea"),
    },
    syntax: {
      ...darkHighlightColors,
      ...Object.fromEntries(
        Object.entries({ ...darkHighlightColors, ...overrides.syntax }).map(
          ([key, value]) => [key, color(value)],
        ),
      ),
    },
    heading: [
      color(overrides.heading?.[0] ?? "#82aaff"),
      color(overrides.heading?.[1] ?? "#89ddff"),
      color(overrides.heading?.[2] ?? "#c3e88d"),
    ],
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
      "markup.link.label": style(theme.accent, { underline: true }),
      "punctuation.special": style(theme.faint),
      conceal: style(theme.faint),
    },
    renderer.nativeScene,
  );
}
