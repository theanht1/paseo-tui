import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import { newTabInput } from "./tab-template.js";

const workspace = {
  id: "w",
  projectId: "p",
  projectRootPath: "/repo",
  workspaceDirectory: "/trees/w",
  name: "W",
};
const current = agent("current", {
  workspaceId: "w",
  provider: "claude",
  model: "opus",
  currentModeId: "plan",
  thinkingOptionId: "high",
  updatedAt: "2026-11-01T00:00:01Z",
});
const recent = agent("recent", {
  workspaceId: "w",
  provider: "codex",
  model: "gpt",
  currentModeId: null,
  updatedAt: "2026-11-01T00:00:09Z",
});

it("copies the current agent tab's provider, model, mode and thinking into the workspace", () => {
  expect(
    newTabInput(
      workspace,
      { kind: "agent", key: "agent:current", agent: current },
      [current, recent],
    ),
  ).toEqual({
    provider: "claude",
    model: "opus",
    modeId: "plan",
    thinkingOptionId: "high",
    cwd: "/trees/w",
    title: null,
    prompt: null,
  });
});
it("falls back to the most recently updated agent of the workspace for terminal or missing tabs", () => {
  const terminal = {
    kind: "terminal" as const,
    key: "terminal:t",
    terminal: { id: "t", name: "Shell", workspaceId: "w", cwd: "/trees/w" },
  };
  expect(newTabInput(workspace, terminal, [current, recent])).toEqual({
    provider: "codex",
    model: "gpt",
    modeId: null,
    cwd: "/trees/w",
    title: null,
    prompt: null,
  });
  expect(
    newTabInput(workspace, null, [
      agent("other", { workspaceId: "elsewhere", model: "x" }),
    ]),
  ).toBeNull();
  expect(
    newTabInput(workspace, null, [agent("nomodel", { workspaceId: "w" })]),
  ).toBeNull();
});
