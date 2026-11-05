import {
  HIGHLIGHT_MAX_SOURCE_BYTES,
  highlightCode,
  isLanguageSupported,
} from "@getpaseo/highlight";
import { colorProp, type Theme } from "./theme.js";

export type StyledLine = { text: string; fg?: string }[];
const FILES: Readonly<Record<string, string>> = {
  ts: "x.ts",
  typescript: "x.ts",
  js: "x.js",
  javascript: "x.js",
  py: "x.py",
  python: "x.py",
  sh: "x.sh",
  bash: "x.sh",
  shell: "x.sh",
  zsh: "x.sh",
  go: "x.go",
  rs: "x.rs",
  rust: "x.rs",
  json: "x.json",
  yaml: "x.yaml",
  yml: "x.yaml",
  diff: "x.diff",
  sql: "x.sql",
  css: "x.css",
  html: "x.html",
  java: "x.java",
  c: "x.c",
  cpp: "x.cpp",
  md: "x.md",
  markdown: "x.md",
};

export function languageFile(lang: string): string | null {
  const language = (lang.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const file = Object.hasOwn(FILES, language) ? FILES[language] : undefined;
  return file && isLanguageSupported(file) ? file : null;
}

export function highlightChunks(
  code: string,
  lang: string,
  theme: Theme,
): StyledLine[] {
  const file = languageFile(lang);
  if (!file || Buffer.byteLength(code, "utf8") > HIGHLIGHT_MAX_SOURCE_BYTES) {
    return code.split("\n").map((text) => [{ text, fg: colorProp(theme.fg) }]);
  }
  return highlightCode(code, file).map((line) =>
    line.map((token) => ({
      text: token.text,
      fg: colorProp(token.style ? theme.syntax[token.style] : theme.fg),
    })),
  );
}
