import { describe, expect, it } from "vitest";
import { findPathMentions, mentionAt, resolvePath } from "./detect.js";

function raws(text: string) {
  return findPathMentions(text).map((mention) => mention.raw);
}

describe("findPathMentions", () => {
  it.each([
    ["Edit src/ui/App.tsx now", "src/ui/App.tsx", "src/ui/App.tsx", null, null],
    ["see /etc/hosts.", "/etc/hosts", "/etc/hosts", null, null],
    [
      "at ~/notes/todo.md, then",
      "~/notes/todo.md",
      "~/notes/todo.md",
      null,
      null,
    ],
    ["(./scripts/run.sh)", "./scripts/run.sh", "./scripts/run.sh", null, null],
    ["../lib/util.ts:42", "../lib/util.ts:42", "../lib/util.ts", 42, null],
    ["src/a.ts:12:7: error", "src/a.ts:12:7", "src/a.ts", 12, 7],
    ["src/a.ts#L30-L40 shows", "src/a.ts#L30-L40", "src/a.ts", 30, null],
    ["README.md is short", "README.md", "README.md", null, null],
    ["`src/foo_bar.py`", "src/foo_bar.py", "src/foo_bar.py", null, null],
    ["**src/bold.ts**", "src/bold.ts", "src/bold.ts", null, null],
    [
      "--config=src/tsconfig.json",
      "src/tsconfig.json",
      "src/tsconfig.json",
      null,
      null,
    ],
    ["Makefile changed", "Makefile", "Makefile", null, null],
    ["'quoted/path.json'", "quoted/path.json", "quoted/path.json", null, null],
    [
      "src/ui/file-links:",
      "src/ui/file-links",
      "src/ui/file-links",
      null,
      null,
    ],
  ])("finds %j", (text, raw, path, line, col) => {
    expect(findPathMentions(text)).toEqual([
      expect.objectContaining({ raw, path, line, col }),
    ]);
  });

  it("reports offsets of every mention", () => {
    const text = "Read a/b.ts and /c/d.md.";
    const mentions = findPathMentions(text);
    expect(mentions.map((m) => text.slice(m.start, m.end))).toEqual([
      "a/b.ts",
      "/c/d.md",
    ]);
  });

  it.each([
    "https://example.com/a/b.ts",
    "see http://x.io/readme.md",
    "file:///tmp/a.txt",
    "mailto:me@example.com",
    "version 0.15.0 and v1.2.3",
    "e.g. this, i.e. that",
    "plain words only",
    "a / b",
    "~ and / alone",
    "# heading",
    "2026/11/04",
    "...",
    "//comment/like.ts",
  ])("ignores %j", (text) => {
    expect(raws(text)).toEqual([]);
  });

  it("finds paths next to URLs without taking the URL", () => {
    expect(raws("https://a.dev/x.ts then src/x.ts")).toEqual(["src/x.ts"]);
  });
});

describe("mentionAt", () => {
  it("returns the mention spanning a column", () => {
    const line = "open src/app.ts:3 please";
    expect(mentionAt(line, 8)?.raw).toBe("src/app.ts:3");
    expect(mentionAt(line, 2)).toBeNull();
  });
});

describe("resolvePath", () => {
  it("resolves relative paths against cwd and keeps absolute and ~ paths", () => {
    expect(resolvePath("src/a.ts", "/repo")).toBe("/repo/src/a.ts");
    expect(resolvePath("./a/../b.ts", "/repo/x")).toBe("/repo/x/b.ts");
    expect(resolvePath("../up.md", "/repo/x")).toBe("/repo/up.md");
    expect(resolvePath("/etc//hosts", "/repo")).toBe("/etc/hosts");
    expect(resolvePath("~/a/./b.md", "/repo")).toBe("~/a/b.md");
  });
});
