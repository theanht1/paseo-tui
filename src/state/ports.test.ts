import type {
  PaseoAgent,
  PaseoAgentCreateOptions,
  PaseoProviderAvailabilityResult,
  PaseoProviderSnapshotResult,
} from "@getpaseo/client";
import { expect, expectTypeOf, test } from "vitest";
import { type CreateAgentInput, createAgentsPort } from "./ports.js";
import { agent } from "./test-fixtures.js";

function setup() {
  const created: PaseoAgentCreateOptions[] = [];
  let current: PaseoAgent | null = agent("created");
  const available: PaseoProviderAvailabilityResult = {
    providers: [
      { provider: "custom", available: false, error: "Missing key" },
      { provider: "codex", available: true },
      { provider: "other", available: true },
    ],
    fetchedAt: "now",
    requestId: "available",
  };
  const snapshot: PaseoProviderSnapshotResult = {
    entries: [
      {
        provider: "codex",
        status: "ready",
        enabled: true,
        label: "Codex",
        defaultModeId: "ask",
      },
      {
        provider: "custom",
        status: "unavailable",
        enabled: true,
        label: "Custom",
      },
    ],
    generatedAt: "now",
    requestId: "snapshot",
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
    providers: {
      async listAvailable() {
        return available;
      },
      async snapshot() {
        return snapshot;
      },
      async listModels(provider: string) {
        return {
          provider,
          models: [
            {
              provider,
              id: "m",
              label: "Model",
              isDefault: true,
              metadata: { ignored: true },
            },
            { provider, id: "n", label: "Next", description: "Details" },
          ],
          fetchedAt: "now",
          requestId: "models",
        };
      },
      async listModes(provider: string) {
        return {
          provider,
          modes: [{ id: "ask", label: "Ask" }],
          fetchedAt: "now",
          requestId: "modes",
        };
      },
    },
  };
  return {
    port: createAgentsPort(api),
    created,
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
test("joins providers by id, preserving order and unavailable entries", async () => {
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
  ]);
});
test("maps model and mode catalogs to port fields", async () => {
  const { port } = setup();
  expect(await port.models("codex")).toEqual([
    { id: "m", label: "Model", description: null, isDefault: true },
    { id: "n", label: "Next", description: "Details", isDefault: false },
  ]);
  expect(await port.modes("codex")).toEqual([
    { id: "ask", label: "Ask", description: null },
  ]);
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
