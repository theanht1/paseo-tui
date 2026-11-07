import type { AgentUsage } from "@getpaseo/protocol/agent-types";
import type { SlashCommand } from "../../connection/ports.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import type { CommandStep } from "../command-center/registry.js";

const CLEAR_PROMPT = "/clear";
export const CLEARED_DIVIDER = "── session cleared ──";
const SESSION_SWITCH = /^Claude switched to a new session: \S+ -> \S+$/;

/** Clearing runs the agent's own `/clear` slash command, so it needs one. */
export function canClear(commands: readonly SlashCommand[]): boolean {
  return commands.some((command) => command.name === "clear");
}

/** The daemon's assistant message when a provider moves to a fresh session. */
export function isSessionSwitchNotice(text: string): boolean {
  return SESSION_SWITCH.test(text);
}

/** `/clear` goes out as a prompt; a running turn is interrupted so it takes effect at once. */
export async function clearSession(
  store: Pick<TimelineStore, "getSnapshot" | "send" | "interrupt">,
): Promise<void> {
  const { kind } = store.getSnapshot().turn;
  if (kind === "running" || kind === "stopping")
    await store.interrupt(CLEAR_PROMPT);
  else await store.send(CLEAR_PROMPT);
}

export function clearSessionStep(
  store: Pick<TimelineStore, "getSnapshot" | "send" | "interrupt">,
  cleared: () => void,
): CommandStep {
  return {
    kind: "confirm",
    title: "Clear this session? The conversation is reset.",
    confirm() {
      cleared();
      void clearSession(store);
    },
  };
}

/** The context usage the agent reported when the session was cleared. */
export interface ClearedUsage {
  usedTokens: number | undefined;
}
/** Usage as of the clear is stale; the meter stays empty until the agent reports different usage. */
export function usageSinceClear(
  usage: AgentUsage | undefined,
  cleared: ClearedUsage | undefined,
): AgentUsage | undefined {
  if (!cleared) return usage;
  return usage?.contextWindowUsedTokens === cleared.usedTokens
    ? undefined
    : usage;
}
