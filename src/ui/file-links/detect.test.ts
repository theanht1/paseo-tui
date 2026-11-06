import { describe, expect, it } from "vitest";
import {
  findPathMentions,
  findUrlMentions,
  mentionAt,
  resolvePath,
  urlAt,
} from "./detect.js";

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

describe("findUrlMentions", () => {
  function urls(text: string) {
    return findUrlMentions(text).map((mention) => mention.url);
  }
  it.each([
    ["see https://example.com/a?b=1 now", "https://example.com/a?b=1"],
    ["at http://x.io/readme.md.", "http://x.io/readme.md"],
    ["(docs: https://x.dev/guide)", "https://x.dev/guide"],
    ["(see https://x.y/a_(b))", "https://x.y/a_(b)"],
    ["<https://x.y/z>", "https://x.y/z"],
    ["[label](https://x.y/z)", "https://x.y/z"],
    ["really? https://x.y/q?!", "https://x.y/q"],
  ])("finds %j", (text, url) => {
    expect(urls(text)).toEqual([url]);
  });
  it.each([
    "ftp://x.y/file",
    "file:///tmp/a.txt",
    "javascript:alert(1)",
    "xhttps://x.y",
    "https://",
    "src/a.ts:12",
  ])("ignores %j", (text) => {
    expect(urls(text)).toEqual([]);
  });
  it("reports offsets, and urlAt finds the URL under a column", () => {
    const line = "open https://a.dev/x then src/a.ts:12";
    const [mention] = findUrlMentions(line);
    expect(mention && line.slice(mention.start, mention.end)).toBe(
      "https://a.dev/x",
    );
    expect(urlAt(line, 8)?.url).toBe("https://a.dev/x");
    expect(urlAt(line, 30)).toBeNull();
    expect(mentionAt(line, 30)?.raw).toBe("src/a.ts:12");
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
