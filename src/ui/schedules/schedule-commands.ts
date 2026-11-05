import type { PaseoAgent } from "@getpaseo/client";
import type {
  SchedulePort,
  ScheduleRun,
  ScheduleSummary,
  ScheduleTargetInput,
} from "../../connection/ports.js";
import { agentName, shortPath } from "../agent/agent-display.js";
import {
  agentConfigurationFlow,
  type ConfigurationDeps,
} from "../command-center/create-agent.js";
import type {
  CommandGroup,
  CommandItem,
  CommandStep,
} from "../command-center/registry.js";
import { relativeDuration } from "../usage/usage-meters.js";
import { cadenceLabel, parseCadence } from "./cadence.js";

export interface ScheduleDeps {
  port: SchedulePort;
  /** Shows a short status-bar notice; failures start with `!`. */
  notify(text: string): void;
  /** Known agents, for target names and opening a run's agent. */
  agents: readonly PaseoAgent[];
  focusedAgent: PaseoAgent | undefined;
  open(agent: PaseoAgent): void;
  /** Workspaces a new-agent schedule can start in. */
  workspaces: readonly { key: string; cwd: string; label: string }[];
  /** Provider/model/mode catalog; without it only existing agents can be targeted. */
  configure?: ConfigurationDeps;
  now(): number;
}

const GROUP: CommandGroup = "Schedules";
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
function scheduleTitle(schedule: Pick<ScheduleSummary, "name" | "prompt">) {
  return schedule.name?.trim() || oneLine(schedule.prompt);
}
function when(iso: string | null, now: number): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return at >= now
    ? `in ${relativeDuration(at - now)}`
    : `${relativeDuration(now - at)} ago`;
}
function targetLabel(
  target: ScheduleSummary["target"] | ScheduleTargetInput,
  agents: readonly PaseoAgent[],
): string {
  if (target.type === "agent") {
    const known = agents.find((agent) => agent.id === target.agentId);
    return known ? agentName(known) : `agent ${target.agentId.slice(0, 8)}`;
  }
  return `new ${target.config.provider} agent in ${shortPath(target.config.cwd)}`;
}
function summaryLine(schedule: ScheduleSummary, deps: ScheduleDeps): string {
  return [
    schedule.status === "active" ? null : schedule.status,
    cadenceLabel(schedule.cadence),
    `→ ${targetLabel(schedule.target, deps.agents)}`,
    schedule.nextRunAt ? `next ${when(schedule.nextRunAt, deps.now())}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Command Center entries: browse schedules and create one. */
export function scheduleCommands(deps: ScheduleDeps): CommandItem[] {
  return [
    {
      id: "schedules",
      group: GROUP,
      title: "Schedules…",
      keywords: ["cron", "recurring", "automation"],
      run: () => schedulesStep(deps),
    },
    newScheduleItem(deps, "new-schedule"),
  ];
}
function newScheduleItem(deps: ScheduleDeps, id: string): CommandItem {
  return {
    id,
    group: GROUP,
    title: "New schedule…",
    subtitle: "Prompt an agent on a cadence",
    keywords: ["create", "cron", "recurring"],
    run: () => cadenceStep(deps),
  };
}

function schedulesStep(deps: ScheduleDeps): CommandStep {
  return {
    kind: "choice",
    title: "Schedules",
    items: async () => [
      newScheduleItem(deps, "schedules:new"),
      ...(await deps.port.list()).map(
        (schedule): CommandItem => ({
          id: `schedule:${schedule.id}`,
          group: GROUP,
          title: scheduleTitle(schedule),
          subtitle: summaryLine(schedule, deps),
          run: () => actionsStep(schedule, deps),
        }),
      ),
    ],
  };
}

function mutation(
  deps: ScheduleDeps,
  action: () => Promise<void>,
  done: string,
): void {
  action().then(
    () => deps.notify(done),
    (error: unknown) => deps.notify(`! ${message(error)}`),
  );
}
function confirmItem(
  id: string,
  title: string,
  question: string,
  confirm: () => void,
): CommandItem {
  return {
    id,
    group: GROUP,
    title,
    run: () => ({ kind: "confirm", title: question, confirm }),
  };
}
function actionsStep(
  schedule: ScheduleSummary,
  deps: ScheduleDeps,
): CommandStep {
  const name = scheduleTitle(schedule);
  const { port } = deps;
  const items: CommandItem[] = [
    {
      id: "schedule:inspect",
      group: GROUP,
      title: "Inspect",
      run: () => inspectStep(schedule.id, deps),
    },
    {
      id: "schedule:logs",
      group: GROUP,
      title: "Recent runs",
      run: () => runsStep(schedule.id, deps),
    },
  ];
  if (schedule.status === "active")
    items.push(
      confirmItem("schedule:pause", "Pause…", `Pause ${name}?`, () =>
        mutation(deps, () => port.pause(schedule.id), `Paused ${name}`),
      ),
    );
  if (schedule.status === "paused")
    items.push(
      confirmItem("schedule:resume", "Resume…", `Resume ${name}?`, () =>
        mutation(deps, () => port.resume(schedule.id), `Resumed ${name}`),
      ),
    );
  items.push(
    confirmItem("schedule:run", "Run now…", `Run ${name} once now?`, () =>
      mutation(deps, () => port.runOnce(schedule.id), `Started ${name}`),
    ),
    confirmItem("schedule:delete", "Delete…", `Delete ${name}?`, () =>
      mutation(deps, () => port.remove(schedule.id), `Deleted ${name}`),
    ),
  );
  return { kind: "choice", title: name, items: () => items };
}

/** Read-only rows: selecting one keeps the view open. */
function infoStep(
  title: string,
  rows: () => Promise<{ title: string; subtitle?: string; run?: () => void }[]>,
): CommandStep {
  const step: CommandStep = {
    kind: "choice",
    title,
    items: async () =>
      (await rows()).map((row, index) => ({
        id: `info:${index}`,
        group: GROUP,
        title: row.title,
        ...(row.subtitle !== undefined ? { subtitle: row.subtitle } : {}),
        run: () => {
          if (!row.run) return step;
          row.run();
          return undefined;
        },
      })),
  };
  return step;
}
function inspectStep(id: string, deps: ScheduleDeps): CommandStep {
  return infoStep("Inspect", async () => {
    const schedule = await deps.port.inspect(id);
    const now = deps.now();
    return [
      `Prompt: ${oneLine(schedule.prompt)}`,
      `Cadence: ${cadenceLabel(schedule.cadence)}`,
      `Target: ${targetLabel(schedule.target, deps.agents)}`,
      `Status: ${schedule.status}`,
      `Next run: ${when(schedule.nextRunAt, now)}`,
      `Last run: ${when(schedule.lastRunAt, now)}`,
      `Created: ${schedule.createdAt}`,
      schedule.maxRuns === null ? null : `Max runs: ${schedule.maxRuns}`,
      schedule.expiresAt === null ? null : `Expires: ${schedule.expiresAt}`,
      `Runs: ${schedule.runs.length}`,
    ].flatMap((title) => (title === null ? [] : [{ title }]));
  });
}
function runTitle(run: ScheduleRun, now: number): string {
  const started = Date.parse(run.startedAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : null;
  const took =
    ended !== null && !Number.isNaN(ended) && !Number.isNaN(started)
      ? ` · took ${Math.max(0, Math.round((ended - started) / 1000))}s`
      : "";
  return `${run.status} · ${when(run.startedAt, now)}${took}`;
}
function runsStep(id: string, deps: ScheduleDeps): CommandStep {
  return infoStep("Recent runs", async () => {
    const now = deps.now();
    return (await deps.port.logs(id))
      .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((run) => {
        const target = deps.agents.find((agent) => agent.id === run.agentId);
        return {
          title: runTitle(run, now),
          subtitle: (run.error ?? run.output ?? "").split("\n")[0] ?? "",
          ...(target ? { run: () => deps.open(target) } : {}),
        };
      });
  });
}

function cadenceStep(deps: ScheduleDeps, error?: string): CommandStep {
  return {
    kind: "input",
    title: error ? `Cadence · ! ${error}` : "Cadence",
    placeholder: "5m, 1h, 1d or cron like 0 9 * * 1-5",
    submit(text) {
      const parsed = parseCadence(text);
      return parsed.kind === "ok"
        ? targetStep(deps, parsed.cron)
        : cadenceStep(deps, parsed.message);
    },
  };
}
function targetStep(deps: ScheduleDeps, cron: string): CommandStep {
  return {
    kind: "choice",
    title: "Target",
    items: () => {
      const items: CommandItem[] = [];
      const focused = deps.focusedAgent;
      if (focused)
        items.push({
          id: "target:focused",
          group: GROUP,
          title: `Send to ${agentName(focused)}`,
          subtitle: "Prompt the focused agent each run",
          run: () =>
            promptStep(deps, cron, { type: "agent", agentId: focused.id }),
        });
      items.push(
        ...deps.agents
          .filter((agent) => agent.id !== focused?.id && !agent.archivedAt)
          .map((agent) => ({
            id: `target:agent:${agent.id}`,
            group: GROUP,
            title: `Send to ${agentName(agent)}`,
            subtitle: `${agent.provider} · ${shortPath(agent.cwd)}`,
            run: () =>
              promptStep(deps, cron, { type: "agent", agentId: agent.id }),
          })),
      );
      const configure = deps.configure;
      if (configure)
        items.push(
          ...deps.workspaces.map((workspace) => ({
            id: `target:workspace:${workspace.key}`,
            group: GROUP,
            title: `New agent in ${workspace.label}`,
            subtitle: `Start a fresh agent each run · ${shortPath(workspace.cwd)}`,
            run: () =>
              agentConfigurationFlow(
                configure,
                workspace.cwd,
                (input) => {
                  const target: ScheduleTargetInput = {
                    type: "new-agent",
                    config: {
                      provider: input.provider,
                      cwd: input.cwd,
                      model: input.model,
                      ...(input.modeId ? { modeId: input.modeId } : {}),
                      ...(input.thinkingOptionId !== undefined
                        ? { thinkingOptionId: input.thinkingOptionId }
                        : {}),
                      ...(input.title ? { title: input.title } : {}),
                    },
                  };
                  return input.prompt
                    ? nameStep(deps, cron, target, input.prompt)
                    : promptStep(deps, cron, target);
                },
                { title: "Prompt", placeholder: "Prompt sent on each run" },
              ),
          })),
        );
      return items;
    },
  };
}
function promptStep(
  deps: ScheduleDeps,
  cron: string,
  target: ScheduleTargetInput,
): CommandStep {
  return {
    kind: "input",
    title: "Prompt",
    placeholder: "Prompt sent on each run (required)",
    submit: (text) =>
      text.trim()
        ? nameStep(deps, cron, target, text)
        : promptStep(deps, cron, target),
  };
}
function nameStep(
  deps: ScheduleDeps,
  cron: string,
  target: ScheduleTargetInput,
  prompt: string,
): CommandStep {
  return {
    kind: "input",
    title: "Name",
    placeholder: "Schedule name (optional)",
    submit(text) {
      const name = text.trim() || null;
      return {
        kind: "confirm",
        title: `Create schedule ${name ? `${name} · ` : ""}${cron} → ${targetLabel(target, deps.agents)}: “${oneLine(prompt)}”?`,
        confirm() {
          deps.port.create({ name, prompt, cron, target }).then(
            (created) =>
              deps.notify(`Created schedule ${scheduleTitle(created)}`),
            (error: unknown) => deps.notify(`! ${message(error)}`),
          );
        },
      };
    },
  };
}
