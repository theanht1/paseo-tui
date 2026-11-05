import type { PaseoAgent } from "@getpaseo/client";
import type { SchedulePort } from "../../connection/ports.js";
import type { CreateDeps } from "../command-center/create-agent.js";
import type { ScheduleDeps } from "./schedule-commands.js";

/** Schedules reuse the new-agent catalog and workspaces when the App has them. */
export function scheduleDeps(
  port: SchedulePort,
  context: {
    notify(text: string): void;
    agents: readonly PaseoAgent[];
    focusedAgent: PaseoAgent | undefined;
    open(agent: PaseoAgent): void;
    createAgent: CreateDeps | undefined;
  },
): ScheduleDeps {
  const { createAgent } = context;
  return {
    port,
    notify: context.notify,
    agents: context.agents,
    focusedAgent: context.focusedAgent,
    open: context.open,
    workspaces: createAgent?.workspaces ?? [],
    ...(createAgent ? { configure: createAgent } : {}),
    now: Date.now,
  };
}
