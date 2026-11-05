import type { PaseoAgent } from "@getpaseo/client";
import type {
  CatalogMode,
  CatalogModel,
  CatalogProvider,
  CreateAgentInput,
} from "../../state/ports.js";
import type { ThinkingPreference } from "../agent/thinking-preference.js";
import type { CommandStep } from "./registry.js";

export interface CreateDeps {
  providers(): Promise<CatalogProvider[]>;
  models(provider: string): Promise<CatalogModel[]>;
  modes(provider: string): Promise<CatalogMode[]>;
  thinkingPreference?: ThinkingPreference;
  workspaces: readonly { key: string; cwd: string; label: string }[];
  defaultCwd: string | null;
  create(input: CreateAgentInput): Promise<PaseoAgent>;
  opened(agent: PaseoAgent): void;
  failed(message: string): void;
}

export type ConfigurationDeps = Pick<
  CreateDeps,
  "providers" | "models" | "modes" | "thinkingPreference"
>;
export function agentConfigurationStep(
  deps: ConfigurationDeps,
  cwd: string,
  onSubmit: (input: CreateAgentInput) => void,
): CommandStep {
  return agentConfigurationFlow(deps, cwd, (input) => {
    onSubmit(input);
    return undefined;
  });
}
/** Provider › Model › Mode › Thinking › Title › prompt; `finish` may continue with another step. */
export function agentConfigurationFlow(
  deps: ConfigurationDeps,
  cwd: string,
  finish: (input: CreateAgentInput) => undefined | CommandStep,
  prompt = {
    title: "First prompt",
    placeholder: "First prompt (optional) · / commands · @ files",
  },
): CommandStep {
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
            run: () => modeStep(cwd, provider, model),
          })),
    };
  }
  function modeStep(
    cwd: string,
    provider: CatalogProvider,
    model: CatalogModel,
  ): CommandStep {
    return {
      kind: "choice",
      title: "Mode",
      items: async () => {
        const modes = await deps.modes(provider.id);
        if (!modes.length)
          return [
            {
              id: "mode:default",
              group: "Agents",
              title: "Provider default",
              run: () => thinkingStep(cwd, provider.id, model, null),
            },
          ];
        return modes
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
            run: () => thinkingStep(cwd, provider.id, model, mode.id),
          }));
      },
    };
  }
  function thinkingStep(
    cwd: string,
    provider: string,
    model: CatalogModel,
    modeId: string | null,
  ): CommandStep {
    const thinking = model.thinking;
    if (!thinking) return titleStep(cwd, provider, model.id, modeId);
    return {
      kind: "choice",
      title: "Thinking",
      items: () => {
        if (thinking.kind === "unsupported") throw Error(thinking.message);
        const preferred = deps.thinkingPreference?.get() ?? "medium";
        return [...thinking.options]
          .sort(
            (a, b) => Number(b.id === preferred) - Number(a.id === preferred),
          )
          .map((option) => ({
            id: `thinking:${option.id}`,
            group: "Agents",
            title: option.label,
            subtitle: [
              option.description,
              option.id === preferred ? "default" : null,
            ]
              .filter(Boolean)
              .join(" · "),
            run: () => {
              deps.thinkingPreference?.set(option.id);
              return titleStep(cwd, provider, model.id, modeId, option.id);
            },
          }));
      },
    };
  }
  function titleStep(
    cwd: string,
    provider: string,
    model: string,
    modeId: string | null,
    thinkingOptionId?: string,
  ): CommandStep {
    return {
      kind: "input",
      title: "Title",
      placeholder: "Agent title (optional)",
      submit: (title) => ({
        kind: "input",
        title: prompt.title,
        placeholder: prompt.placeholder,
        completion: {
          source: {
            kind: "draft",
            config: {
              provider,
              cwd,
              model,
              ...(modeId ? { modeId } : {}),
              ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
            },
          },
          cwd,
        },
        submit: (text) =>
          finish({
            provider,
            model,
            modeId,
            ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
            cwd,
            title: title.trim() || null,
            prompt: text.trim() ? text : null,
          }),
      }),
    };
  }
  return providerStep(cwd);
}
export function createAgentStep(deps: CreateDeps): CommandStep {
  function configured(cwd: string) {
    return agentConfigurationStep(deps, cwd, (input) => {
      const create = () => deps.create(input);
      void (
        deps.thinkingPreference
          ? deps.thinkingPreference.flush().then(create)
          : create()
      ).then(deps.opened, (error: unknown) =>
        deps.failed(error instanceof Error ? error.message : String(error)),
      );
    });
  }
  if (deps.defaultCwd) return configured(deps.defaultCwd);
  return {
    kind: "choice",
    title: "Workspace",
    items: () =>
      deps.workspaces.map((workspace) => ({
        id: `workspace:${workspace.key}`,
        group: "Workspaces",
        title: workspace.label,
        subtitle: workspace.cwd,
        run: () => configured(workspace.cwd),
      })),
  };
}
