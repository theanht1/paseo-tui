import type { WorkspaceStateBucket } from "@getpaseo/protocol/agent-state-bucket";
import { expect, it } from "vitest";
import {
  advanceHold,
  type BucketHold,
  displayedBuckets,
  releaseHold,
} from "./bucket-hold.js";

const real = (...entries: [string, WorkspaceStateBucket][]) => new Map(entries);

it("holds a workspace that becomes active while unread, and masks done", () => {
  const hold = advanceHold(null, "a", real(["a", "attention"]));
  expect(hold).toEqual({ workspaceId: "a", released: false });
  const after = advanceHold(hold, "a", real(["a", "done"]));
  expect(after).toBe(hold);
  expect(displayedBuckets(after, real(["a", "done"])).get("a")).toBe(
    "attention",
  );
});

it("does not hold a workspace that is not unread when it becomes active", () => {
  const hold = advanceHold(null, "a", real(["a", "done"]));
  expect(displayedBuckets(hold, real(["a", "done"])).get("a")).toBe("done");
  const later = advanceHold(hold, "a", real(["a", "attention"]));
  expect(displayedBuckets(later, real(["a", "attention"])).get("a")).toBe(
    "attention",
  );
});

it("releases when the active workspace changes or disappears", () => {
  const hold: BucketHold = { workspaceId: "a", released: false };
  const moved = advanceHold(hold, "b", real(["a", "done"], ["b", "done"]));
  expect(displayedBuckets(moved, real(["a", "done"])).get("a")).toBe("done");
  expect(advanceHold(hold, null, real(["a", "done"]))).toBeNull();
  const back = advanceHold(moved, "a", real(["a", "done"]));
  expect(displayedBuckets(back, real(["a", "done"])).get("a")).toBe("done");
});

it("shows the real bucket and drops the hold once it is not done", () => {
  const hold: BucketHold = { workspaceId: "a", released: false };
  for (const bucket of ["needs_input", "failed", "running"] as const) {
    const next = advanceHold(hold, "a", real(["a", bucket]));
    expect(displayedBuckets(next, real(["a", bucket])).get("a")).toBe(bucket);
    const idle = advanceHold(next, "a", real(["a", "done"]));
    expect(displayedBuckets(idle, real(["a", "done"])).get("a")).toBe("done");
  }
});

it("an explicit release lets the row move and stays released while active", () => {
  const hold: BucketHold = { workspaceId: "a", released: false };
  const released = releaseHold(hold, ["a"]);
  expect(advanceHold(released, "a", real(["a", "attention"]))).toBe(released);
  expect(displayedBuckets(released, real(["a", "done"])).get("a")).toBe("done");
  expect(releaseHold(hold, ["b"])).toBe(hold);
  expect(releaseHold(null, ["a"])).toBeNull();
});
