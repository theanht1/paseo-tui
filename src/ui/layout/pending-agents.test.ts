import { expect, test } from "vitest";
import { agent } from "../../test/fixtures.js";
import { createPendingAgents } from "./pending-agents.js";
import { assign, initialLayout, panes } from "./split-tree.js";

const shown = (id: string) => assign(initialLayout(), id);

test("keeps a just-created agent's pane until the list includes it", () => {
  const pending = createPendingAgents();
  pending.add("new", 0);
  const layout = shown("new");
  expect(pending.clearMissing(layout, [], 9_999)).toBe(layout);
  expect(panes(pending.clearMissing(layout, [], 10_000))[0]?.agentId).toBe(
    null,
  );
});

test("clears panes whose agent disappeared and was never pending", () => {
  const pending = createPendingAgents();
  const layout = shown("gone");
  expect(panes(pending.clearMissing(layout, [], 0))[0]?.agentId).toBe(null);
  expect(pending.clearMissing(layout, [agent("gone")], 0)).toBe(layout);
});

test("prune forgets agents that arrived, expired, or left every pane", () => {
  const pending = createPendingAgents();
  pending.add("arrived", 0);
  pending.add("expired", 0);
  pending.add("unshown", 5_000);
  pending.add("waiting", 5_000);
  const layout = assign(
    assign(assign(initialLayout(), "arrived"), "expired"),
    "waiting",
  );
  pending.prune(
    [...panes(layout), { kind: "pane", id: "x", agentId: "expired" }],
    [agent("arrived")],
    10_000,
  );
  expect([...pending.ids()]).toEqual(["waiting"]);
});

test("reports the wait until the next expiry, so an early timer can reschedule", () => {
  const pending = createPendingAgents();
  expect(pending.untilExpiry(0)).toBe(null);
  pending.add("a", 0);
  pending.add("b", 4_000);
  expect(pending.untilExpiry(1_000)).toBe(9_000);
  // A timer that fires a few ms early still has time left to wait.
  expect(pending.untilExpiry(9_995)).toBe(5);
  expect(pending.untilExpiry(10_000)).toBe(4_000);
  expect(pending.untilExpiry(14_000)).toBe(null);
});
