import { expect, test } from "vitest";
import {
  loadNewWorkspaceMemory,
  newWorkspacePath,
} from "./new-workspace-memory.js";

function storage(initial: string | null = null) {
  let contents = initial;
  return {
    get contents() {
      return contents;
    },
    async read() {
      return contents;
    },
    async write(next: string) {
      contents = next;
    },
  };
}

test("the last new workspace lives under XDG_STATE_HOME", () => {
  expect(newWorkspacePath({ XDG_STATE_HOME: "/s" }, "/home/me")).toBe(
    "/s/paseo-tui/new-workspace.json",
  );
  expect(newWorkspacePath({}, "/home/me")).toBe(
    "/home/me/.local/state/paseo-tui/new-workspace.json",
  );
});

test("keeps the last project, host, provider, model and thinking across a restart", async () => {
  const file = storage();
  const memory = await loadNewWorkspaceMemory(file);
  expect(memory.last()).toBeNull();
  const choice = {
    projectId: "p",
    hostId: "build",
    provider: "claude",
    model: "opus",
    thinkingOptionId: "high",
  };
  memory.set(choice);
  await memory.flush();
  const restarted = await loadNewWorkspaceMemory(storage(file.contents));
  expect(restarted.last()).toEqual(choice);
  memory.set({ ...choice, hostId: null, thinkingOptionId: null });
  await memory.flush();
  expect((await loadNewWorkspaceMemory(storage(file.contents))).last()).toEqual(
    { ...choice, hostId: null, thinkingOptionId: null },
  );
});

test("ignores a damaged file", async () => {
  expect((await loadNewWorkspaceMemory(storage("{"))).last()).toBeNull();
  expect(
    (
      await loadNewWorkspaceMemory(
        storage('{"version":1,"projectId":"p","provider":"claude"}'),
      )
    ).last(),
  ).toBeNull();
});
