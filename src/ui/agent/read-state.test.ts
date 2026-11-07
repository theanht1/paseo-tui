import { expect, test } from "vitest";
import { readAction, unreadWorkspaceIds } from "./read-state.js";

test("offers Mark as read for unread and failed workspaces", () => {
  expect(readAction("attention", true)).toEqual({
    kind: "read",
    title: "Mark as read",
  });
  expect(readAction("failed", false)).toEqual({
    kind: "read",
    title: "Mark as read",
  });
});

test("offers Mark as unread for idle read workspaces only when supported", () => {
  expect(readAction("done", true)).toEqual({
    kind: "unread",
    title: "Mark as unread",
  });
  expect(readAction("done", false)).toBeNull();
});

test("offers nothing while the workspace is running or waiting on you", () => {
  expect(readAction("running", true)).toBeNull();
  expect(readAction("needs_input", true)).toBeNull();
});

test("lists the workspaces that are unread or failed", () => {
  const buckets = new Map([
    ["a", "attention"],
    ["b", "done"],
    ["c", "failed"],
    ["d", "needs_input"],
    ["e", "running"],
  ] as const);
  expect(unreadWorkspaceIds(buckets)).toEqual(["a", "c"]);
});
