import { expect, it } from "vitest";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { PINS_UNSUPPORTED, pinCommands } from "./pin-commands.js";

const workspace: WorkspaceRow = {
  id: "one",
  activityAt: null,
  statusEnteredAt: null,
  projectId: "repo",
  name: "one",
  workspaceDirectory: "/repo/one",
  projectRootPath: "/repo",
  pinnedAt: null,
};
function context(row: WorkspaceRow | null, supported = true) {
  const toggled: string[] = [];
  return {
    toggled,
    items: pinCommands({
      workspace: row,
      canPin: () => supported,
      toggle: (target) => toggled.push(target.id),
    }),
  };
}

it("offers Pin workspace for an unpinned workspace and Unpin for a pinned one", () => {
  const pin = context(workspace);
  expect(pin.items.map((item) => [item.group, item.title])).toEqual([
    ["Workspaces", "Pin workspace"],
  ]);
  expect(pin.items[0]?.action).toEqual({ type: "workspace.togglePin" });
  pin.items[0]?.run();
  expect(pin.toggled).toEqual(["one"]);
  const unpin = context({ ...workspace, pinnedAt: "2026-11-06T00:00:00Z" });
  expect(unpin.items.map((item) => item.title)).toEqual(["Unpin workspace"]);
});

it("explains that the daemon needs updating when the workspace's host cannot pin", () => {
  const { items, toggled } = context(workspace, false);
  expect(items.map((item) => item.title)).toEqual(["Pin workspace"]);
  expect(items[0]?.subtitle).toBe(PINS_UNSUPPORTED);
  const step = items[0]?.run();
  expect(step?.kind === "readOnly" ? step.lines() : []).toEqual([
    PINS_UNSUPPORTED,
  ]);
  expect(toggled).toEqual([]);
});

it("offers nothing without a selected workspace", () => {
  expect(context(null).items).toEqual([]);
});
