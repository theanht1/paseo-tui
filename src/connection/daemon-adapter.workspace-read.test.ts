import { expect, test } from "vitest";
import {
  createWorkspaceReadAdapter,
  type WorkspaceReadDaemon,
} from "./daemon-adapter.js";

function fake(features: { workspaceMarkUnread?: boolean } | undefined) {
  const calls: string[] = [];
  const daemon: WorkspaceReadDaemon = {
    async clearWorkspaceAttention(ids) {
      calls.push(`clear ${[ids].flat().join(",")}`);
    },
    async markWorkspaceUnread(id) {
      calls.push(`unread ${id}`);
    },
    getLastServerInfoMessage: () => (features ? { features } : null),
  };
  return { calls, port: createWorkspaceReadAdapter(daemon) };
}

test("marks several workspaces read in one request", async () => {
  const { calls, port } = fake({});
  await port.markRead(["a", "b"]);
  expect(calls).toEqual(["clear a,b"]);
});

test("marks a workspace unread when the daemon advertises workspaceMarkUnread", async () => {
  const { calls, port } = fake({ workspaceMarkUnread: true });
  await port.markUnread?.("a");
  expect(calls).toEqual(["unread a"]);
});

test("has no mark-unread without the feature", () => {
  expect(fake({}).port.markUnread).toBeNull();
  expect(fake(undefined).port.markUnread).toBeNull();
});
