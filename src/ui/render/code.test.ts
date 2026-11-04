import { HIGHLIGHT_MAX_SOURCE_BYTES } from "@getpaseo/highlight";
import { describe, expect, it } from "vitest";
import { highlightChunks, languageFile } from "./code.js";
import { createTheme } from "./theme.js";

const theme = createTheme({});
describe("code highlighting", () => {
  it.each([
    ["ts", "x.ts"],
    ["py", "x.py"],
    ["sh", null],
    ["go", "x.go"],
    ["rust", "x.rs"],
    ["json", "x.json"],
    ["yaml", "x.yaml"],
    ["Foo", null],
  ])("maps %s to %s", (language, file) => {
    expect(languageFile(language)).toBe(file);
  });
  it("gives keywords and strings different colors without changing text", () => {
    const chunks = highlightChunks('const name = "hello";', "ts", theme).flat();
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(
      'const name = "hello";',
    );
    expect(chunks.find((chunk) => chunk.text === "const")?.fg).toBe(
      theme.syntax.keyword,
    );
    expect(chunks.find((chunk) => chunk.text.includes("hello"))?.fg).toBe(
      theme.syntax.string,
    );
    expect(theme.syntax.keyword).not.toBe(theme.syntax.string);
  });
  it.each(["__proto__", "constructor", "toString"])(
    "treats inherited object keys as unknown: %s",
    (lang) => {
      expect(languageFile(lang)).toBeNull();
      expect(highlightChunks("plain", lang, theme)).toEqual([
        [{ text: "plain", fg: theme.fg }],
      ]);
    },
  );
  it("uses one plain chunk per line for unknown languages", () => {
    expect(highlightChunks("one\ntwo\n", "Foo", theme)).toEqual([
      [{ text: "one", fg: theme.fg }],
      [{ text: "two", fg: theme.fg }],
      [{ text: "", fg: theme.fg }],
    ]);
  });
  it("uses the byte budget rather than character count", () => {
    const code = "é".repeat(HIGHLIGHT_MAX_SOURCE_BYTES / 2 + 1);
    expect(highlightChunks(code, "ts", theme)).toEqual([
      [{ text: code, fg: theme.fg }],
    ]);
  });
  it("omits foreground colors with NO_COLOR", () => {
    const plain = createTheme({ NO_COLOR: "1" });
    for (const lang of ["ts", "Foo"]) {
      expect(
        highlightChunks('const x = "hi";', lang, plain)
          .flat()
          .every((chunk) => chunk.fg === undefined),
      ).toBe(true);
    }
    expect(Object.values(plain.syntax).every((color) => color === "")).toBe(
      true,
    );
    expect(plain.heading).toEqual(["", "", ""]);
  });
});
