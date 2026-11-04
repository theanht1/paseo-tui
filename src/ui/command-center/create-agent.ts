import type { PaseoAgent } from "@getpaseo/client";
import type {
  CatalogMode,
  CatalogModel,
  CatalogProvider,
  CreateAgentInput,
} from "../../state/ports.js";
import type { CommandStep } from "./registry.js";

export interface CreateDeps {
  providers(): Promise<CatalogProvider[]>;
  models(provider: string): Promise<CatalogModel[]>;
  modes(provider: string): Promise<CatalogMode[]>;
  workspaces: readonly { key: string; cwd: string; label: string }[];
  defaultCwd: string | null;
  create(input: CreateAgentInput): Promise<PaseoAgent>;
  opened(agent: PaseoAgent): void;
  failed(message: string): void;
}

export function createAgentStep(deps: CreateDeps): CommandStep {
  function providerStep(cwd: string): CommandStep {
    const step: CommandStep = {
      kind: "choice",
      title: "Provider",
      items: async () =>
        (await deps.providers()).map((provider) => ({
          id: `provider:${provider.id}`,
          group: "Agents",
          title: provider.label,
          subtitle: provider.error ?? "",
          run: () => (provider.available ? modelStep(cwd, provider) : step),
        })),
    };
    return step;
  }
  function modelStep(cwd: string, provider: CatalogProvider): CommandStep {
    return {
      kind: "choice",
      title: "Model",
      items: async () =>
        (await deps.models(provider.id))
          .toSorted((a, b) => Number(b.isDefault) - Number(a.isDefault))
          .map((model) => ({
            id: `model:${model.id}`,
            group: "Agents",
            title: model.label,
            subtitle: [model.description, model.isDefault ? "default" : null]
              .filter(Boolean)
              .join(" · "),
            run: () => modeStep(cwd, provider, model.id),
          })),
    };
  }
  function modeStep(
    cwd: string,
    provider: CatalogProvider,
    model: string,
  ): CommandStep {
    return {
      kind: "choice",
      title: "Mode",
      items: async () =>
        (await deps.modes(provider.id))
          .toSorted(
            (a, b) =>
              Number(b.id === provider.defaultModeId) -
              Number(a.id === provider.defaultModeId),
          )
          .map((mode) => ({
            id: `mode:${mode.id}`,
            group: "Agents",
            title: mode.label,
            subtitle: [
              mode.description,
              mode.id === provider.defaultModeId ? "default" : null,
            ]
              .filter(Boolean)
              .join(" · "),
            run: () => titleStep(cwd, provider.id, model, mode.id),
          })),
    };
  }
  function titleStep(
    cwd: string,
    provider: string,
    model: string,
    modeId: string,
  ): CommandStep {
    return {
      kind: "input",
      title: "Title",
      placeholder: "Agent title (optional)",
      submit: (title) => ({
        kind: "input",
        title: "First prompt",
        placeholder: "First prompt (optional)",
        submit(prompt): undefined {
          void deps
            .create({
              provider,
              model,
              modeId,
              cwd,
              title: title.trim() || null,
              prompt: prompt.trim() ? prompt : null,
            })
            .then(deps.opened, (error: unknown) => {
              deps.failed(
                error instanceof Error ? error.message : String(error),
              );
            });
        },
      }),
    };
  }
  if (deps.defaultCwd) return providerStep(deps.defaultCwd);
  return {
    kind: "choice",
    title: "Workspace",
    items: () =>
      deps.workspaces.map((workspace) => ({
        id: `workspace:${workspace.key}`,
        group: "Workspaces",
        title: workspace.label,
        subtitle: workspace.cwd,
        run: () => providerStep(workspace.cwd),
      })),
  };
}
