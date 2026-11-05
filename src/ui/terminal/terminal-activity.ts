import { deriveTerminalActivityStatusBucket } from "@getpaseo/protocol/terminal-activity";
import type { TerminalActivity } from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";
import type { Indicator } from "../agent/attention.js";

interface ActivityFields {
  id: string;
  activity: TerminalActivity | null;
}
function finishKey(terminal: ActivityFields): string {
  return `${terminal.id}@${terminal.activity?.changedAt ?? ""}`;
}

/** Terminal tab dots, like agents: spinner while working, `!` on needs-input, ● when finished. */
export function terminalIndicator(
  terminal: ActivityFields,
  acknowledged: ReadonlySet<string>,
): Indicator {
  switch (deriveTerminalActivityStatusBucket(terminal.activity)) {
    case "running":
      return { kind: "working" };
    case "needs_input":
      return { kind: "permission" };
    case "attention":
      return acknowledged.has(finishKey(terminal))
        ? { kind: "none" }
        : { kind: "unread", reason: "finished" };
    case null:
      return { kind: "none" };
  }
}

/** Client-side acknowledgement of finished terminals the user has looked at. */
export function createTerminalAttention() {
  const emitter = createEmitter();
  let acknowledged: ReadonlySet<string> = new Set();
  return {
    getSnapshot: () => acknowledged,
    subscribe: emitter.subscribe,
    view(terminal: ActivityFields) {
      if (terminalIndicator(terminal, acknowledged).kind !== "unread") return;
      acknowledged = new Set(acknowledged).add(finishKey(terminal));
      emitter.notify();
    },
  };
}
