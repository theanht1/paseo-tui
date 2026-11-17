import { describe, expect, it } from "vitest";
import type { CreateAgentInput } from "../../state/ports.js";
import { at } from "../../test/at.js";
import { agent } from "../../test/fixtures.js";
import {
  agentConfigurationStep,
  type CreateDeps,
  createAgentStep,
  type WorkspaceTarget,
} from "./create-agent.js";
import type { CommandItem } from "./registry.js";

async function choices(step: ReturnType<CommandItem["run"]>) {
  if (step?.kind !== "choice") throw Error("Expected choice");
  return step.items();
}
function submit(step: ReturnType<CommandItem["run"]>, text: string) {
  if (step?.kind !== "input") throw Error("Expected input");
  return step.submit(text);
}
const repo = { key: "repo", cwd: "/repo", label: "Repo" };
function fixture(defaultWorkspace: WorkspaceTarget | null = repo) {
  const created = agent("new");
  const inputs: CreateAgentInput[] = [];
  const workspaceIds: string[] = [];
  const opened: string[] = [];
  const failed: string[] = [];
  const deps: CreateDeps = {
    providers: async () => [
      {
        id: "offline",
        label: "Offline",
        available: false,
        error: "Sign in",
        defaultModeId: null,
      },
      {
        id: "codex",
        label: "Codex",
        available: true,
        error: null,
        defaultModeId: "ask",
      },
    ],
    models: async () => [
      { id: "other", label: "Other", description: null, isDefault: false },
      { id: "best", label: "Best", description: null, isDefault: true },
    ],
    modes: async () => [
      { id: "auto", label: "Auto", description: null },
      { id: "ask", label: "Ask", description: null },
    ],
    workspaces: [repo],
    defaultWorkspace,
    async create(workspaceId, input) {
      workspaceIds.push(workspaceId);
      inputs.push(input);
      return created;
    },
    opened(value) {
      opened.push(value.id);
    },
    failed(message) {
      failed.push(message);
    },
  };
  return { deps, created, inputs, workspaceIds, opened, failed };
}
async function titleStep(deps: CreateDeps) {
  const providers = await choices(createAgentStep(deps));
  const models = await choices(at(providers, 1).run());
  expect(at(models, 0).title).toBe("Best");
  expect(at(models, 0).subtitle).toContain("default");
  const modes = await choices(at(models, 0).run());
  expect(at(modes, 0).title).toBe("Ask");
  expect(at(modes, 0).subtitle).toContain("default");
  return at(modes, 0).run();
}
describe("create agent steps", () => {
  it("skips workspace with a focused cwd, orders defaults first, and opens success with null empty fields", async () => {
    const f = fixture();
    expect(createAgentStep(f.deps).title).toBe("Provider");
    submit(submit(await titleStep(f.deps), "  "), "");
    await Promise.resolve();
    expect(f.inputs).toEqual([
      {
        provider: "codex",
        model: "best",
        modeId: "ask",
        cwd: "/repo",
        title: null,
        prompt: null,
      },
    ]);
    expect(f.workspaceIds).toEqual(["repo"]);
    expect(f.opened).toEqual([f.created.id]);
  });
  it("creates in the workspace picked when none is focused", async () => {
    const f = fixture(null);
    const workspaces = await choices(createAgentStep(f.deps));
    const providers = await choices(at(workspaces, 0).run());
    const models = await choices(at(providers, 1).run());
    const modes = await choices(at(models, 0).run());
    submit(submit(at(modes, 0).run(), ""), "");
    await Promise.resolve();
    expect(f.workspaceIds).toEqual(["repo"]);
  });
  it("offers existing workspaces when no cwd is focused", async () => {
    const f = fixture(null);
    const root = createAgentStep(f.deps);
    expect(root.title).toBe("Workspace");
    const workspaces = await choices(root);
    expect(at(workspaces, 0).title).toBe("Repo");
    expect(at(workspaces, 0).run()?.title).toBe("Provider");
  });
  it("keeps unavailable providers on the provider step", async () => {
    const f = fixture();
    const root = createAgentStep(f.deps);
    const providers = await choices(root);
    expect(at(providers, 0).subtitle).toBe("Sign in");
    const next = at(providers, 0).run();
    expect(next?.title).toBe("Provider");
    expect(next).toBe(root);
    expect((await choices(next)).map((item) => item.title)).toEqual([
      "Offline",
      "Codex",
    ]);
    expect(f.inputs).toEqual([]);
  });
  it("reports create rejection", async () => {
    const f = fixture();
    f.deps.create = async () => {
      throw Error("Create denied");
    };
    submit(submit(await titleStep(f.deps), "Name"), "hi");
    await Promise.resolve();
    expect(f.failed).toEqual(["Create denied"]);
    expect(f.opened).toEqual([]);
  });
});
it("allows the provider default when the provider exposes no selectable modes", async () => {
  const f = fixture();
  f.deps.modes = async () => [];
  const providers = await choices(createAgentStep(f.deps));
  const models = await choices(at(providers, 1).run());
  const modes = await choices(at(models, 0).run());
  expect(modes[0]?.title).toBe("Provider default");
  submit(submit(at(modes, 0).run(), "Agent"), "hello");
  await Promise.resolve();
  expect(f.inputs[0]?.modeId).toBeNull();
});
it("selects medium thinking by default, persists a supported choice, and sends the native thinking option", async () => {
  const { loadThinkingPreference } = await import(
    "../agent/thinking-preference.js"
  );
  let contents: string | null = null;
  const preference = await loadThinkingPreference({
    read: async () => contents,
    write: async (value) => {
      contents = value;
    },
  });
  const f = fixture();
  f.deps.thinkingPreference = preference;
  f.deps.models = async () => [
    {
      id: "best",
      label: "Best",
      description: null,
      isDefault: true,
      thinking: {
        kind: "options",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
        ],
      },
    },
  ];
  const providers = await choices(createAgentStep(f.deps));
  const models = await choices(at(providers, 1).run());
  const modes = await choices(at(models, 0).run());
  const thinking = await choices(at(modes, 0).run());
  expect(at(thinking, 0).title).toBe("Medium");
  const high = thinking.find((item) => item.title === "High");
  if (!high) throw Error("No high option");
  submit(submit(high.run(), "Title"), "Prompt");
  await preference.flush();
  await new Promise((resolve) => setImmediate(resolve));
  expect(f.inputs[0]).toMatchObject({ thinkingOptionId: "high" });
  const restarted = await loadThinkingPreference({
    read: async () => contents,
    write: async () => {},
  });
  expect(restarted.get()).toBe("high");
});

describe("last used configuration", () => {
  async function steps(last: {
    provider: string;
    model: string;
    thinkingOptionId: string | null;
  }) {
    const { deps } = fixture();
    deps.models = async () => [
      { id: "other", label: "Other", description: null, isDefault: false },
      {
        id: "best",
        label: "Best",
        description: null,
        isDefault: true,
        thinking: {
          kind: "options",
          options: [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      },
    ];
    const providers = await choices(
      agentConfigurationStep(deps, "/repo", () => {}, { last }),
    );
    const codex = providers.find((item) => item.title === "Codex");
    if (!codex) throw Error("No Codex");
    const models = await choices(codex.run());
    const best = models.find((item) => item.title === "Best");
    if (!best) throw Error("No Best");
    const modes = await choices(best.run());
    const thinking = await choices(at(modes, 0).run());
    return { providers, models, thinking };
  }
  it("puts the last provider, model and thinking level first", async () => {
    const { providers, models, thinking } = await steps({
      provider: "codex",
      model: "best",
      thinkingOptionId: "high",
    });
    expect(providers.map((item) => [item.title, item.subtitle])).toEqual([
      ["Codex", "last used"],
      ["Offline", "Sign in"],
    ]);
    expect(models.map((item) => [item.title, item.subtitle])).toEqual([
      ["Best", "default · last used"],
      ["Other", ""],
    ]);
    expect(thinking.map((item) => [item.title, item.subtitle])).toEqual([
      ["High", "last used"],
      ["Medium", ""],
    ]);
  });
  it("keeps the defaults for another provider", async () => {
    const { models, thinking } = await steps({
      provider: "claude",
      model: "other",
      thinkingOptionId: "high",
    });
    expect(models.map((item) => item.title)).toEqual(["Best", "Other"]);
    expect(thinking.map((item) => [item.title, item.subtitle])).toEqual([
      ["Medium", "default"],
      ["High", ""],
    ]);
  });
});

describe("title step placeholder", () => {
  async function titlePlaceholder(
    options?: Parameters<typeof agentConfigurationStep>[3],
  ) {
    const { deps } = fixture();
    const providers = await choices(
      agentConfigurationStep(deps, "/repo", () => {}, options),
    );
    const models = await choices(at(providers, 1).run());
    const modes = await choices(at(models, 0).run());
    const step = at(modes, 0).run();
    if (step?.kind !== "input") throw Error("Expected title");
    return step.placeholder;
  }
  it("title step uses the given placeholder", async () => {
    expect(await titlePlaceholder({ titlePlaceholder: "Custom title" })).toBe(
      "Custom title",
    );
    expect(await titlePlaceholder()).toBe("Agent title (optional)");
  });
});

it("says providers are loading and re-lists them when the catalog changes", () => {
  const { deps } = fixture();
  const listeners: (() => void)[] = [];
  const step = createAgentStep({
    ...deps,
    onProvidersChange(listener) {
      listeners.push(listener);
      return () => {};
    },
  });
  if (step.kind !== "choice") throw Error("Expected choice");
  expect(step.loading).toBe("Loading providers…");
  let relisted = 0;
  step.subscribe?.(() => relisted++);
  at(listeners, 0)();
  expect(relisted).toBe(1);
});
