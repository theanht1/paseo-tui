import { expect, test } from "vitest";
import {
  createWorkspacePinAdapter,
  type WorkspacePinDaemon,
} from "./daemon-adapter.js";

function fake(features: { workspacePinning?: boolean } | undefined) {
  const calls: string[] = [];
  const daemon: WorkspacePinDaemon = {
    async setWorkspacePinned(id, pinned) {
      calls.push(`${pinned ? "pin" : "unpin"} ${id}`);
      return { pinnedAt: pinned ? "2026-11-06T00:00:00Z" : null };
    },
    getLastServerInfoMessage: () => (features ? { features } : null),
  };
  return { calls, port: createWorkspacePinAdapter(daemon) };
}

test("pins and unpins a workspace when the daemon advertises workspacePinning", async () => {
  const { calls, port } = fake({ workspacePinning: true });
  await port?.setPinned("a", true);
  await port?.setPinned("a", false);
  expect(calls).toEqual(["pin a", "unpin a"]);
});

test("has no pinning without the feature", () => {
  expect(fake({}).port).toBeNull();
  expect(fake(undefined).port).toBeNull();
});
