import { expect, it } from "vitest";
import { diffToolTab, diffToolTerminal, resolveDiffTool } from "./diff-tool.js";

it("prefers --diff-tool, then PASEO_TUI_DIFF_TOOL, then lazygit", () => {
  expect(resolveDiffTool(undefined, {})).toBe("lazygit");
  expect(
    resolveDiffTool(undefined, { PASEO_TUI_DIFF_TOOL: "tig status" }),
  ).toBe("tig status");
  expect(
    resolveDiffTool(" gitui ", { PASEO_TUI_DIFF_TOOL: "tig status" }),
  ).toBe("gitui");
  expect(resolveDiffTool(undefined, { PASEO_TUI_DIFF_TOOL: "  " })).toBe(
    "lazygit",
  );
  expect(() => resolveDiffTool(" ", {})).toThrow("--diff-tool");
});

it("runs the command through sh in a terminal named after the program", () => {
  expect(diffToolTerminal("lazygit")).toEqual({
    name: "lazygit",
    command: "sh",
    args: ["-c", "lazygit"],
  });
  expect(diffToolTerminal("/opt/bin/gitui --watcher").name).toBe("gitui");
});

it("finds the tool's open tab in the workspace only", () => {
  const terminals = [
    { id: "shell", workspaceId: "w", cwd: "/repo", name: "Shell" },
    { id: "other", workspaceId: "x", cwd: "/x", name: "lazygit" },
    { id: "lg", workspaceId: "w", cwd: "/repo", name: "lazygit" },
  ];
  expect(diffToolTab("w", terminals, "lazygit")).toEqual({
    kind: "terminal",
    key: "terminal:lg",
    terminal: terminals[2],
  });
  expect(diffToolTab("w", terminals, "gitui")).toBeNull();
});
