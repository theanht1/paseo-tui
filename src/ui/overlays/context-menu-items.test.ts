import { expect, it } from "vitest";
import { agent } from "../../test/fixtures.js";
import type { WorkspaceRow, WorkspaceTab } from "../workspace/workspaces.js";
import { type MenuActions, menuItems } from "./context-menu-items.js";

const workspace: WorkspaceRow = {
  id: "one",
  activityAt: null,
  statusEnteredAt: null,
  projectId: "repo",
  name: "one",
  workspaceDirectory: "/repo/one",
  projectRootPath: "/repo",
};
const tab: WorkspaceTab = { kind: "agent", key: "agent:a", agent: agent("a") };
function recorder(canPin = false) {
  const events: string[] = [];
  const actions: MenuActions = {
    rename: () => events.push("rename"),
    archive: (target) => events.push(`archive ${target.id}`),
    labels: (target) => events.push(`labels ${target.id}`),
    canPin: () => canPin,
    setPinned: (target, pinned) =>
      events.push(`${pinned ? "pin" : "unpin"} ${target.id}`),
  };
  return { events, actions };
}

it("lists Rename, Labels… and Archive for a workspace with distinct shortcuts", () => {
  const { actions, events } = recorder();
  const items = menuItems({ kind: "workspace", workspace }, actions);
  expect(items.map((item) => [item.title, item.shortcut])).toEqual([
    ["Rename", "r"],
    ["Labels…", "l"],
    ["Archive workspace", "a"],
  ]);
  for (const item of items) item.run();
  expect(events).toEqual(["rename", "labels one", "archive one"]);
});

it("offers Pin or Unpin with p when the workspace's host supports pinning", () => {
  const { actions, events } = recorder(true);
  const pin = menuItems({ kind: "workspace", workspace }, actions);
  expect(pin.map((item) => [item.title, item.shortcut])).toEqual([
    ["Rename", "r"],
    ["Pin", "p"],
    ["Labels…", "l"],
    ["Archive workspace", "a"],
  ]);
  pin.find((item) => item.id === "pin")?.run();
  const pinned = { ...workspace, pinnedAt: "2026-11-06T00:00:00Z" };
  const unpin = menuItems({ kind: "workspace", workspace: pinned }, actions);
  expect(unpin.find((item) => item.id === "pin")?.title).toBe("Unpin");
  unpin.find((item) => item.id === "pin")?.run();
  expect(events).toEqual(["pin one", "unpin one"]);
});

it("lists only Rename for a tab", () => {
  const { actions } = recorder();
  expect(
    menuItems({ kind: "tab", tab }, actions).map((item) => item.id),
  ).toEqual(["rename"]);
});
