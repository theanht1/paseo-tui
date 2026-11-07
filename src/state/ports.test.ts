import type { PaseoAgent, PaseoAgentCreateOptions } from "@getpaseo/client";
import { expect, expectTypeOf, test } from "vitest";
import { at } from "../test/at.js";
import { agent } from "../test/fixtures.js";
import { type CreateAgentInput, createAgentsPort } from "./ports.js";
import {
  createProviderCatalog,
  type ProviderEntry,
} from "./provider-catalog.js";

const CODEX: ProviderEntry = {
  provider: "codex",
  status: "ready",
  enabled: true,
  label: "Codex",
  defaultModeId: "ask",
};
function setup(
  thinkingSupported = false,
  thinkingOptions?: { id: string; label: string }[],
  entries: ProviderEntry[] = [
    {
      provider: "custom",
      status: "error",
      enabled: true,
      label: "Custom",
      error: "Missing key",
    },
    CODEX,
    { provider: "other", status: "ready", enabled: true },
    { provider: "warming", status: "loading", enabled: true },
    { provider: "off", status: "unavailable", enabled: false, label: "Off" },
  ],
) {
  const created: PaseoAgentCreateOptions[] = [];
  const listed: string[] = [];
  let current: PaseoAgent | null = agent("created");
  let push: (entries: readonly ProviderEntry[]) => void = () => {};
  const catalog = createProviderCatalog({
    async snapshot() {
      return entries;
    },
    observe(handler) {
      push = handler;
      return async () => {};
    },
    async refresh() {},
  });
  const providers = {
    async listModels(provider: string) {
      listed.push(`models:${provider}`);
      return {
        provider,
        models: [
          {
            provider,
            id: "m",
            label: "Model",
            isDefault: true,
            ...(thinkingOptions ? { thinkingOptions } : {}),
            metadata: { ignored: true },
          },
          { provider, id: "n", label: "Next", description: "Details" },
          { provider, id: "x", label: "Hidden", isSelectable: false },
        ],
        fetchedAt: "now",
        requestId: "models",
      };
    },
    async listModes(provider: string) {
      listed.push(`modes:${provider}`);
      return {
        provider,
        modes: [{ id: "ask", label: "Ask" }],
        fetchedAt: "now",
        requestId: "modes",
      };
    },
  };
  const api = {
    agents: {
      async list(): Promise<never> {
        throw new Error("Unused list");
      },
      subscribe() {
        return () => {};
      },
      async create(options: PaseoAgentCreateOptions) {
        created.push(options);
        return { current: () => current };
      },
    },
    providers,
  };
  return {
    port: createAgentsPort(api, catalog, thinkingSupported),
    created,
    listed,
    push(next: ProviderEntry[]) {
      push(next);
    },
    clear: () => {
      current = null;
    },
  };
}
const input: CreateAgentInput = {
  provider: "codex",
  model: "m",
  modeId: "ask",
  cwd: "/project",
  title: "Title",
  prompt: "Hi",
};
test("lists enabled snapshot entries, hiding disabled ones; only ready ones are available", async () => {
  expect(await setup().port.providers()).toEqual([
    {
      id: "custom",
      label: "Custom",
      available: false,
      error: "Missing key",
      defaultModeId: null,
    },
    {
      id: "codex",
      label: "Codex",
      available: true,
      error: null,
      defaultModeId: "ask",
    },
    {
      id: "other",
      label: "other",
      available: true,
      error: null,
      defaultModeId: null,
    },
    {
      id: "warming",
      label: "warming",
      available: false,
      error: "loading",
      defaultModeId: null,
    },
  ]);
});
test("maps model and mode catalogs to port fields, hiding unselectable models", async () => {
  const { port } = setup();
  expect(await port.models("codex")).toEqual([
    { id: "m", label: "Model", description: null, isDefault: true },
    { id: "n", label: "Next", description: "Details", isDefault: false },
  ]);
  expect(await port.modes("codex")).toEqual([
    { id: "ask", label: "Ask", description: null },
  ]);
});
test("reads models and modes from the snapshot entry without asking the daemon", async () => {
  const { port, listed } = setup(false, undefined, [
    {
      ...CODEX,
      models: [
        { provider: "codex", id: "gpt", label: "GPT", isDefault: true },
        {
          provider: "codex",
          id: "hidden",
          label: "Hidden",
          isSelectable: false,
        },
      ],
      modes: [{ id: "auto", label: "Auto", description: "Hands off" }],
    },
  ]);
  expect(await port.models("codex")).toEqual([
    { id: "gpt", label: "GPT", description: null, isDefault: true },
  ]);
  expect(await port.modes("codex")).toEqual([
    { id: "auto", label: "Auto", description: "Hands off" },
  ]);
  expect(listed).toEqual([]);
});
test("asks the daemon for missing models and modes once until that provider's entry changes", async () => {
  const { port, listed, push } = setup(false, undefined, [
    CODEX,
    { provider: "other", status: "ready", enabled: true },
  ]);
  await port.models("codex");
  await port.models("codex");
  await port.modes("codex");
  await port.modes("codex");
  expect(listed).toEqual(["models:codex", "modes:codex"]);
  push([
    CODEX,
    { provider: "other", status: "ready", enabled: true, label: "Other" },
  ]);
  await port.models("codex");
  expect(listed).toEqual(["models:codex", "modes:codex"]);
  push([{ ...CODEX, label: "Codex 2" }]);
  await port.models("codex");
  await port.modes("codex");
  expect(listed).toEqual([
    "models:codex",
    "modes:codex",
    "models:codex",
    "modes:codex",
  ]);
});
test("rejects models for a provider the snapshot does not list", async () => {
  await expect(setup().port.models("missing")).rejects.toThrow(
    "Unknown provider: missing",
  );
});
test("tells listeners when the provider snapshot changes", async () => {
  const { port, push } = setup();
  await port.providers();
  let changes = 0;
  const stop = port.onProvidersChange(() => changes++);
  push([CODEX]);
  stop();
  push([CODEX, { provider: "other", status: "ready", enabled: true }]);
  expect(changes).toBe(1);
});
test("creates with provider/model and optional fields and returns the snapshot", async () => {
  const { port, created } = setup();
  expect(await port.create(input)).toEqual(agent("created"));
  expect(created).toEqual([
    {
      config: { provider: "codex/m", modeId: "ask" },
      cwd: "/project",
      title: "Title",
      prompt: "Hi",
    },
  ]);
});
test("keeps the model while omitting null optional fields", async () => {
  const { port, created } = setup();
  await port.create({
    provider: "codex",
    model: "m",
    modeId: null,
    cwd: "/project",
    title: null,
    prompt: null,
  });
  expect(created).toEqual([
    { config: { provider: "codex/m" }, cwd: "/project" },
  ]);
});
test("rejects a creation without a snapshot", async () => {
  const { port, clear } = setup();
  clear();
  await expect(port.create(input)).rejects.toThrow(
    "Agent created but no snapshot",
  );
});

test("requires a concrete model when creating an agent", () => {
  expectTypeOf<CreateAgentInput["model"]>().toEqualTypeOf<string>();
});
test("preserves model thinking options and sends thinkingOptionId only with daemon support", async () => {
  const supported = setup(true, [
    { id: "medium", label: "Medium" },
    { id: "high", label: "High" },
  ]);
  expect(at(await supported.port.models("codex"), 0).thinking).toMatchObject({
    kind: "options",
    options: [
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
    ],
  });
  await supported.port.create({ ...input, thinkingOptionId: "high" });
  expect(at(supported.created, 0).config.thinkingOptionId).toBe("high");
  const unsupported = setup(false, [{ id: "medium", label: "Medium" }]);
  expect(at(await unsupported.port.models("codex"), 0).thinking).toMatchObject({
    kind: "unsupported",
  });
  await expect(
    unsupported.port.create({ ...input, thinkingOptionId: "medium" }),
  ).rejects.toThrow(/Update/);
  expect(unsupported.created).toEqual([]);
});
