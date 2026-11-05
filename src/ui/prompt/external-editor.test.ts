import { describe, expect, it } from "vitest";
import {
  type EditorDeps,
  editExternally,
  editorCommand,
  nodeEditorFiles,
} from "./external-editor.js";

function fakes(edit: (text: string) => { code: number; text?: string | null }) {
  const events: string[] = [];
  const files = new Map<string, string>();
  const deps: EditorDeps = {
    env: { EDITOR: "nano" },
    host: {
      async suspend() {
        events.push("suspend");
      },
      async resume() {
        events.push("resume");
      },
    },
    files: {
      async create(text) {
        files.set("/tmp/prompt.md", text);
        events.push("write");
        return "/tmp/prompt.md";
      },
      async read(path) {
        return files.get(path) ?? null;
      },
      async remove(path) {
        files.delete(path);
        events.push("remove");
      },
    },
    async spawn(command, path) {
      events.push(`spawn:${command}:${path}`);
      const result = edit(files.get(path) ?? "");
      if (result.text === null) files.delete(path);
      else if (result.text !== undefined) files.set(path, result.text);
      return result.code;
    },
  };
  return { deps, events, files };
}

describe("external editor", () => {
  it("round-trips the prompt through the editor with the renderer suspended", async () => {
    const { deps, events, files } = fakes((text) => ({
      code: 0,
      text: `${text} edited\n`,
    }));
    expect(await editExternally("draft", deps)).toBe("draft edited");
    expect(events).toEqual([
      "write",
      "suspend",
      "spawn:nano:/tmp/prompt.md",
      "resume",
      "remove",
    ]);
    expect(files.size).toBe(0);
  });

  it("keeps the prompt on a non-zero exit or a missing file", async () => {
    expect(
      await editExternally("draft", fakes(() => ({ code: 1, text: "x" })).deps),
    ).toBe("draft");
    expect(
      await editExternally(
        "draft",
        fakes(() => ({ code: 0, text: null })).deps,
      ),
    ).toBe("draft");
  });

  it("resumes the renderer even when the editor fails to start", async () => {
    const { deps, events } = fakes(() => {
      throw Error("ENOENT");
    });
    await expect(editExternally("draft", deps)).rejects.toThrow("ENOENT");
    expect(events).toContain("resume");
  });

  it("prefers VISUAL, then EDITOR, then vim", () => {
    expect(editorCommand({ VISUAL: "code -w", EDITOR: "nano" })).toBe(
      "code -w",
    );
    expect(editorCommand({ EDITOR: "nano" })).toBe("nano");
    expect(editorCommand({ EDITOR: " " })).toBe("vim");
  });

  it("creates, reads and removes real temp files", async () => {
    const files = nodeEditorFiles();
    const path = await files.create("hello");
    expect(await files.read(path)).toBe("hello");
    await files.remove(path);
    expect(await files.read(path)).toBeNull();
  });
});
