import { expect, it } from "vitest";
import {
  DEFAULT_EDITOR,
  editorTab,
  workspaceEditorTerminal,
} from "./workspace-editor.js";

it("editor command keeps its arguments and opens the cwd", () => {
  expect(workspaceEditorTerminal("code -w")).toEqual({
    name: "code",
    command: "sh",
    args: ["-c", "code -w ."],
  });
  expect(workspaceEditorTerminal("nvim").name).toBe("nvim");
  expect(DEFAULT_EDITOR).toBe("nvim");
});

it("reuses the open editor tab", () => {
  const terminals = [
    { id: "other", workspaceId: "x", cwd: "/x", name: "nvim" },
    { id: "ed", workspaceId: "w", cwd: "/repo", name: "nvim" },
  ];
  expect(editorTab("w", terminals, "nvim")).toEqual({
    kind: "terminal",
    key: "terminal:ed",
    terminal: terminals[1],
  });
  expect(editorTab("y", terminals, "nvim")).toBeNull();
});
