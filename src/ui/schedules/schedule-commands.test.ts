import type { PaseoAgent } from "@getpaseo/client";
import { expect, test } from "vitest";
import type {
  CreateScheduleInput,
  SchedulePort,
  ScheduleRun,
  ScheduleSummary,
  StoredSchedule,
} from "../../connection/ports.js";
import { agent } from "../../test/fixtures.js";
import type { CommandItem, CommandStep } from "../command-center/registry.js";
import { type ScheduleDeps, scheduleCommands } from "./schedule-commands.js";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const AGENT_ID = "00000000-0000-4000-8000-000000000001";
const nightly: ScheduleSummary = {
  id: "s1",
  name: "Nightly tests",
  status: "active",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  cadence: { type: "every", everyMs: 300_000 },
  target: { type: "agent", agentId: AGENT_ID },
  prompt: "Run the tests",
  nextRunAt: "2026-11-04T12:03:00Z",
  lastRunAt: "2026-11-04T11:58:00Z",
  pausedAt: null,
  expiresAt: null,
  maxRuns: null,
};
const paused: ScheduleSummary = {
  ...nightly,
  id: "s2",
  name: null,
  status: "paused",
  prompt: "Summarize open PRs",
  cadence: { type: "cron", expression: "0 9 * * 1-5" },
  target: {
    type: "new-agent",
    config: { provider: "claude", cwd: "/repo/one" },
  },
  nextRunAt: null,
};
const run: ScheduleRun = {
  id: "r1",
  scheduledFor: "2026-11-04T10:00:00Z",
  startedAt: "2026-11-04T10:00:00Z",
  endedAt: "2026-11-04T10:00:12Z",
  status: "failed",
  agentId: AGENT_ID,
  output: null,
  error: "Agent crashed\nstack…",
};
class FakeSchedules implements SchedulePort {
  calls: unknown[][] = [];
  failure: Error | null = null;
  async list() {
    this.calls.push(["list"]);
    return [nightly, paused];
  }
  async inspect(id: string): Promise<StoredSchedule> {
    this.calls.push(["inspect", id]);
    return { ...nightly, runs: [run] };
  }
  async logs(id: string) {
    this.calls.push(["logs", id]);
    return [run];
  }
  async mutate(name: string, id: string) {
    this.calls.push([name, id]);
    if (this.failure) throw this.failure;
  }
  pause = (id: string) => this.mutate("pause", id);
  resume = (id: string) => this.mutate("resume", id);
  runOnce = (id: string) => this.mutate("runOnce", id);
  remove = (id: string) => this.mutate("remove", id);
  async create(input: CreateScheduleInput) {
    this.calls.push(["create", input]);
    return nightly;
  }
}
function deps(overrides: Partial<ScheduleDeps> = {}) {
  const port = new FakeSchedules();
  const notices: string[] = [];
  const opened: string[] = [];
  const alpha: PaseoAgent = agent(AGENT_ID, { title: "Alpha agent" });
  const value: ScheduleDeps = {
    port,
    notify: (text) => notices.push(text),
    agents: [alpha],
    focusedAgent: alpha,
    open: (target) => opened.push(target.id),
    workspaces: [{ key: "one", cwd: "/repo/one", label: "one" }],
    configure: {
      providers: async () => [
        {
          id: "claude",
          label: "Claude",
          available: true,
          error: null,
          defaultModeId: null,
        },
      ],
      models: async () => [
        { id: "opus", label: "Opus", description: null, isDefault: true },
      ],
      modes: async () => [],
    },
    now: () => NOW,
    ...overrides,
  };
  return { value, port, notices, opened };
}
function item(items: readonly CommandItem[], title: string): CommandItem {
  const found = items.find((entry) => entry.title === title);
  if (!found)
    throw Error(
      `No "${title}" in ${items.map((entry) => entry.title).join(", ")}`,
    );
  return found;
}
async function choices(step: CommandStep | undefined) {
  if (step?.kind !== "choice")
    throw Error(`Expected choice, got ${step?.kind}`);
  return step.items();
}
function input(step: CommandStep | undefined, text: string) {
  if (step?.kind !== "input") throw Error(`Expected input, got ${step?.kind}`);
  return step.submit(text);
}
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("the Command Center offers schedules and a new schedule", () => {
  const titles = scheduleCommands(deps().value).map((entry) => entry.title);
  expect(titles).toEqual(["Schedules…", "New schedule…"]);
});

test("schedules list name, cadence, target, next run and paused state", async () => {
  const { value } = deps();
  const rows = await choices(item(scheduleCommands(value), "Schedules…").run());
  expect(rows.map((row) => [row.title, row.subtitle])).toEqual([
    ["New schedule…", "Prompt an agent on a cadence"],
    ["Nightly tests", "every 5m · → Alpha agent · next in 3m"],
    [
      "Summarize open PRs",
      "paused · cron 0 9 * * 1-5 · → new claude agent in /repo/one",
    ],
  ]);
});

async function actions(value: ScheduleDeps, title: string) {
  const rows = await choices(item(scheduleCommands(value), "Schedules…").run());
  return choices(item(rows, title).run());
}

test("an active schedule offers inspect, logs, pause, run now and delete", async () => {
  const titles = (await actions(deps().value, "Nightly tests")).map(
    (row) => row.title,
  );
  expect(titles).toEqual([
    "Inspect",
    "Recent runs",
    "Pause…",
    "Run now…",
    "Delete…",
  ]);
  const resumable = (await actions(deps().value, "Summarize open PRs")).map(
    (row) => row.title,
  );
  expect(resumable).toContain("Resume…");
});

test("mutations wait for confirmation and report the outcome", async () => {
  const { value, port, notices } = deps();
  const rows = await actions(value, "Nightly tests");
  for (const [title, call] of [
    ["Pause…", "pause"],
    ["Run now…", "runOnce"],
    ["Delete…", "remove"],
  ] as const) {
    const step = item(rows, title).run();
    expect(step?.kind).toBe("confirm");
    expect(port.calls.some(([name]) => name === call)).toBe(false);
    if (step?.kind === "confirm") step.confirm();
    await flush();
    expect(port.calls.at(-1)).toEqual([call, "s1"]);
  }
  expect(notices).toEqual([
    "Paused Nightly tests",
    "Started Nightly tests",
    "Deleted Nightly tests",
  ]);
});

test("a failed mutation shows the daemon's error", async () => {
  const { value, port, notices } = deps();
  port.failure = Error("Schedule not found");
  const step = item(
    await actions(value, "Summarize open PRs"),
    "Resume…",
  ).run();
  if (step?.kind === "confirm") step.confirm();
  await flush();
  expect(notices).toEqual(["! Schedule not found"]);
});

test("inspect shows the full schedule and recent runs open their agent", async () => {
  const { value, opened } = deps();
  const rows = await actions(value, "Nightly tests");
  const details = await choices(item(rows, "Inspect").run());
  expect(details.map((row) => row.title)).toEqual([
    "Prompt: Run the tests",
    "Cadence: every 5m",
    "Target: Alpha agent",
    "Status: active",
    "Next run: in 3m",
    "Last run: 2m ago",
    "Created: 2026-11-01T00:00:00Z",
    "Runs: 1",
  ]);
  const runs = await choices(item(rows, "Recent runs").run());
  expect(runs.map((row) => [row.title, row.subtitle])).toEqual([
    ["failed · 2h ago · took 12s", "Agent crashed"],
  ]);
  expect(runs[0]?.run()).toBeUndefined();
  expect(opened).toEqual([AGENT_ID]);
});

test("a new schedule for the focused agent asks cadence, prompt and name, then confirms", async () => {
  const { value, port } = deps();
  const cadence = item(scheduleCommands(value), "New schedule…").run();
  const invalid = input(cadence, "7m");
  expect(invalid?.title).toContain("doesn't divide evenly");
  const targets = await choices(input(invalid, "5m"));
  const prompt = item(targets, "Send to Alpha agent").run();
  const name = input(prompt, "Check CI");
  const confirm = input(name, "  ");
  expect(confirm?.kind).toBe("confirm");
  expect(confirm?.title).toBe(
    "Create schedule */5 * * * * → Alpha agent: “Check CI”?",
  );
  expect(port.calls).toEqual([]);
  if (confirm?.kind === "confirm") confirm.confirm();
  await flush();
  expect(port.calls).toEqual([
    [
      "create",
      {
        name: null,
        prompt: "Check CI",
        cron: "*/5 * * * *",
        target: { type: "agent", agentId: AGENT_ID },
      },
    ],
  ]);
});

test("a new schedule can start a configured agent in a workspace", async () => {
  const { value, port, notices } = deps();
  const cadence = item(scheduleCommands(value), "New schedule…").run();
  const targets = await choices(input(cadence, "0 9 * * 1-5"));
  const providers = await choices(item(targets, "New agent in one").run());
  const models = await choices(item(providers, "Claude").run());
  const modes = await choices(item(models, "Opus").run());
  const title = item(modes, "Provider default").run();
  const prompt = input(title, "");
  expect(prompt?.title).toBe("Prompt");
  const emptyPrompt = input(prompt, " ");
  expect(emptyPrompt?.title).toBe("Prompt");
  const name = input(emptyPrompt, "Triage issues");
  const confirm = input(name, "Morning triage");
  if (confirm?.kind === "confirm") confirm.confirm();
  await flush();
  expect(port.calls).toEqual([
    [
      "create",
      {
        name: "Morning triage",
        prompt: "Triage issues",
        cron: "0 9 * * 1-5",
        target: {
          type: "new-agent",
          config: { provider: "claude", cwd: "/repo/one", model: "opus" },
        },
      },
    ],
  ]);
  expect(notices).toEqual(["Created schedule Nightly tests"]);
});
