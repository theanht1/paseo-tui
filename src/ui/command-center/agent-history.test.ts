import type { PaseoAgent } from "@getpaseo/client";
import { describe, expect, it } from "vitest";
import type {
  ForkAttachment,
  RewindMode,
  TimelineCursor,
} from "../../connection/ports.js";
import type { CatalogModel, CreateAgentInput } from "../../state/ports.js";
import type { ForkSeed } from "../../state/timeline-store.js";
import { at } from "../../test/at.js";
import { agent, timelineStore } from "../../test/fixtures.js";
import { historyCommands } from "./agent-history.js";
import type { CommandItem, CommandStep } from "./registry.js";

const prompts = {
  epoch: "e",
  prompts: [
    { seq: 2, timestamp: "2026-11-01T09:00:00Z", preview: "first ask" },
    { seq: 9, timestamp: "2026-11-01T10:30:00Z", preview: "second ask" },
  ],
};
const attachment: ForkAttachment = {
  type: "text",
  mimeType: "text/plain",
  text: "history",
};
const rewindable = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindBoth: true,
};
const models: CatalogModel[] = [
  {
    id: "big",
    label: "Big",
    description: null,
    isDefault: true,
    thinking: {
      kind: "options",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
  },
  { id: "small", label: "Small", description: null, isDefault: false },
];
function setup(value: PaseoAgent, enabled = true, createError?: Error) {
  const calls: unknown[][] = [];
  const created: CreateAgentInput[] = [];
  const failures: string[] = [];
  const opened: string[] = [];
  const store = timelineStore(
    enabled
      ? {
          prompts: async () => prompts,
          rewind: async (prompt: TimelineCursor, mode: RewindMode) => {
            calls.push(["rewind", prompt, mode]);
          },
          fork: async (
            prompt: TimelineCursor,
            withHistory: boolean,
          ): Promise<ForkSeed> => {
            calls.push(["fork", prompt, withHistory]);
            return {
              text: "the full ask",
              attachment: withHistory ? attachment : null,
            };
          },
          setThinking: async (optionId: string) => {
            calls.push(["thinking", optionId]);
          },
        }
      : {},
  );
  const items = historyCommands({
    agent: value,
    store,
    models: async () => models,
    createAgent: {
      async create(input) {
        if (createError) throw createError;
        created.push(input);
        return agent("fork");
      },
      opened(next) {
        opened.push(next.id);
      },
      failed(message) {
        failures.push(message);
      },
    },
  });
  return { items, calls, created, failures, opened };
}
function find(items: readonly CommandItem[], id: string) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw Error(`missing ${id}`);
  return item;
}
async function choices(step: undefined | CommandStep) {
  if (step?.kind !== "choice") throw Error("expected a choice");
  return step.items();
}
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("history commands", () => {
  it("hides every command the daemon or agent cannot support", () => {
    expect(setup(agent("a", { model: "big" }), false).items).toEqual([]);
    expect(
      setup(agent("a", { model: null })).items.map((item) => item.id),
    ).toEqual(["set-thinking"]);
  });
  it("lists the model's thinking options, marks the current one and sets it", async () => {
    const { items, calls } = setup(
      agent("a", { model: "big", thinkingOptionId: "low" }),
    );
    const options = await choices(find(items, "set-thinking").run());
    expect(options.map((option) => [option.title, option.subtitle])).toEqual([
      ["Low", "current"],
      ["High", "default"],
    ]);
    at(options, 1).run();
    expect(calls).toEqual([["thinking", "high"]]);
  });
  it("explains when the agent's model has no thinking options", async () => {
    const { items } = setup(agent("a", { model: "small" }));
    await expect(choices(find(items, "set-thinking").run())).rejects.toThrow(
      "Small has no thinking options",
    );
  });
  it("rewinds to a chosen prompt after choosing a mode and confirming", async () => {
    const { items, calls } = setup(
      agent("a", { model: "big", title: "Alpha", capabilities: rewindable }),
    );
    const list = await choices(find(items, "rewind").run());
    expect(list.map((item) => [item.title, item.subtitle])).toEqual([
      ["second ask", "2026-11-01 10:30"],
      ["first ask", "2026-11-01 09:00"],
    ]);
    const modes = await choices(at(list, 0).run());
    expect(modes.map((mode) => mode.title)).toEqual([
      "Conversation only",
      "Conversation and files",
    ]);
    const confirm = at(modes, 1).run();
    if (confirm?.kind !== "confirm") throw Error("expected confirmation");
    expect(confirm.title).toBe(
      "Rewind Alpha to before “second ask” (conversation and files)?",
    );
    expect(calls).toEqual([]);
    confirm.confirm();
    expect(calls).toEqual([["rewind", { epoch: "e", seq: 9 }, "both"]]);
  });
  it("skips the mode choice when the provider rewinds one way only", async () => {
    const { items } = setup(
      agent("a", {
        capabilities: { ...rewindable, supportsRewindBoth: false },
      }),
    );
    const list = await choices(find(items, "rewind").run());
    expect(at(list, 0).run()?.kind).toBe("confirm");
    const single = setup(
      agent("a", {
        capabilities: { ...rewindable, supportsRewindConversation: false },
      }),
    );
    const step = at(await choices(find(single.items, "rewind").run()), 0).run();
    expect(step?.kind).toBe("confirm");
  });
  it("forks from a prompt with the history before it and the agent's settings", async () => {
    const { items, calls, created, opened } = setup(
      agent("a", {
        title: "Alpha",
        model: "big",
        currentModeId: "auto",
        thinkingOptionId: "high",
        cwd: "/repo",
      }),
    );
    const list = await choices(find(items, "fork").run());
    const input = at(list, 0).run();
    if (input?.kind !== "input") throw Error("expected a prompt input");
    input.submit("  ");
    await settle();
    expect(calls).toEqual([["fork", { epoch: "e", seq: 9 }, true]]);
    expect(created).toEqual([
      {
        provider: "codex",
        model: "big",
        modeId: "auto",
        thinkingOptionId: "high",
        cwd: "/repo",
        title: "Fork of Alpha",
        prompt: "the full ask",
        attachments: [attachment],
      },
    ]);
    expect(opened).toEqual(["fork"]);
  });
  it("forks from the first prompt without history, using the typed prompt", async () => {
    const { items, calls, created } = setup(agent("a", { model: "big" }));
    const list = await choices(find(items, "fork").run());
    const input = at(list, 1).run();
    if (input?.kind !== "input") throw Error("expected a prompt input");
    input.submit("try another way");
    await settle();
    expect(calls).toEqual([["fork", { epoch: "e", seq: 2 }, false]]);
    expect(created[0]).toMatchObject({
      prompt: "try another way",
      attachments: [],
      modeId: null,
    });
    expect(created[0]).not.toHaveProperty("thinkingOptionId");
  });
  it("reports fork failures", async () => {
    const { items, failures, opened } = setup(
      agent("a", { model: "big" }),
      true,
      Error("Provider unavailable"),
    );
    const list = await choices(find(items, "fork").run());
    const step = at(list, 0).run();
    if (step?.kind !== "input") throw Error("expected a prompt input");
    step.submit("x");
    await settle();
    expect(failures).toEqual(["Provider unavailable"]);
    expect(opened).toEqual([]);
  });
});
