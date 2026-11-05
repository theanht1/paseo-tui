import { expect, test, vi } from "vitest";
import type { TerminalActivity } from "../../connection/ports.js";
import {
  createTerminalAttention,
  terminalIndicator,
} from "./terminal-activity.js";

function terminal(activity: TerminalActivity | null) {
  return { id: "t1", activity };
}
const none = new Set<string>();

test.each<[TerminalActivity | null, string]>([
  [null, "none"],
  [{ state: "idle", changedAt: 1 }, "none"],
  [{ state: "working", changedAt: 1 }, "working"],
  [
    { state: "idle", attentionReason: "needs_input", changedAt: 1 },
    "permission",
  ],
  [{ state: "idle", attentionReason: "finished", changedAt: 1 }, "unread"],
])("activity %j shows %s", (activity, kind) => {
  expect(terminalIndicator(terminal(activity), none).kind).toBe(kind);
});

test("viewing a finished terminal acknowledges only that finish", () => {
  const attention = createTerminalAttention();
  const listener = vi.fn();
  attention.subscribe(listener);
  const finished = terminal({
    state: "idle",
    attentionReason: "finished",
    changedAt: 5,
  });
  attention.view(finished);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(terminalIndicator(finished, attention.getSnapshot()).kind).toBe(
    "none",
  );
  const later = terminal({
    state: "idle",
    attentionReason: "finished",
    changedAt: 9,
  });
  expect(terminalIndicator(later, attention.getSnapshot()).kind).toBe("unread");
  attention.view(terminal({ state: "working", changedAt: 10 }));
  expect(listener).toHaveBeenCalledTimes(1);
});
