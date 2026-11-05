import { expect, it } from "vitest";
import { editorTerminal } from "./editor-terminal.js";

function link(
  path: string,
  line: number | null = null,
  col: number | null = null,
) {
  return { path, line, col, raw: path, source: "text" as const };
}

it("runs vim directly on absolute paths, honoring line and column", () => {
  expect(editorTerminal(link("/repo/src/a b.ts"))).toEqual({
    name: "a b.ts",
    command: "vim",
    args: ["--", "/repo/src/a b.ts"],
  });
  expect(editorTerminal(link("/repo/x.ts", 12)).args).toEqual([
    "+12",
    "--",
    "/repo/x.ts",
  ]);
  expect(editorTerminal(link("/repo/x.ts", 12, 5)).args).toEqual([
    "+call cursor(12,5)",
    "--",
    "/repo/x.ts",
  ]);
});

it("lets a shell expand ~ while quoting the rest of the path", () => {
  expect(editorTerminal(link("~/it's here/n.md", 3))).toEqual({
    name: "n.md",
    command: "sh",
    args: ["-c", "exec vim '+3' -- ~/'it'\\''s here/n.md'"],
  });
});
