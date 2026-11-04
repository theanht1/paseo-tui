import { describe, expect, it } from "vitest";
import type { CreateAgentInput } from "../../state/ports.js";
import { agent } from "../../state/test-fixtures.js";
import { type CreateDeps, createAgentStep } from "./create-agent.js";
import type { CommandItem } from "./registry.js";

async function choices(step: ReturnType<CommandItem["run"]>) {
  if (step?.kind !== "choice") throw Error("Expected choice");
  return step.items();
}
function submit(step: ReturnType<CommandItem["run"]>, text: string) {
  if (step?.kind !== "input") throw Error("Expected input");
  return step.submit(text);
}
function fixture(defaultCwd: string | null = "/repo") {
  const created = agent("new");
  const inputs: CreateAgentInput[] = [];
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
    workspaces: [{ key: "repo", cwd: "/repo", label: "Repo" }],
    defaultCwd,
    async create(input) {
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
  return { deps, created, inputs, opened, failed };
}
async function titleStep(deps: CreateDeps) {
  const providers = await choices(createAgentStep(deps));
  const models = await choices(providers[1].run());
  expect(models[0].title).toBe("Best");
  expect(models[0].subtitle).toContain("default");
  const modes = await choices(models[0].run());
  expect(modes[0].title).toBe("Ask");
  expect(modes[0].subtitle).toContain("default");
  return modes[0].run();
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
    expect(f.opened).toEqual([f.created.id]);
  });
  it("offers existing workspaces when no cwd is focused", async () => {
    const f = fixture(null);
    const root = createAgentStep(f.deps);
    expect(root.title).toBe("Workspace");
    const workspaces = await choices(root);
    expect(workspaces[0].title).toBe("Repo");
    expect(workspaces[0].run()?.title).toBe("Provider");
  });
  it("keeps unavailable providers on the provider step", async () => {
    const f = fixture();
    const root = createAgentStep(f.deps);
    const providers = await choices(root);
    expect(providers[0].subtitle).toBe("Sign in");
    const next = providers[0].run();
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
