import type { PaseoAgent } from "@getpaseo/client";
import type { CompletionPort } from "../../connection/ports.js";
import type {
  CatalogMode,
  CatalogModel,
  CatalogProvider,
  CreateAgentInput,
} from "../../state/ports.js";
import type { ThinkingPreference } from "../agent/thinking-preference.js";
import type { CommandStep } from "./registry.js";

export interface WorkspaceTarget {
  key: string;
  cwd: string;
  label: string;
}
export interface CreateDeps {
  providers(): Promise<CatalogProvider[]>;
  models(provider: string): Promise<CatalogModel[]>;
  modes(provider: string): Promise<CatalogMode[]>;
  /** Re-lists the Provider step when the host's provider snapshot changes. */
  onProvidersChange?(listener: () => void): () => void;
  thinkingPreference?: ThinkingPreference;
  /** The host's own completions for the first prompt; absent uses the focused host's. */
  completions?: CompletionPort;
  workspaces: readonly WorkspaceTarget[];
  defaultWorkspace: WorkspaceTarget | null;
  /** Adds the agent to the workspace, so the daemon never picks one from the cwd. */
  create(workspaceId: string, input: CreateAgentInput): Promise<PaseoAgent>;
  opened(agent: PaseoAgent): void;
  failed(message: string): void;
}

export type ConfigurationDeps = Pick<
  CreateDeps,
  | "providers"
  | "models"
  | "modes"
  | "onProvidersChange"
  | "thinkingPreference"
  | "completions"
>;
export function agentConfigurationStep(
  deps: ConfigurationDeps,
  cwd: string,
  onSubmit: (input: CreateAgentInput) => void,
  options?: ConfigurationOptions,
): CommandStep {
  return agentConfigurationFlow(
    deps,
    cwd,
    (input) => {
      onSubmit(input);
      return undefined;
    },
    undefined,
    options,
  );
}
export interface ConfigurationOptions {
  titlePlaceholder?: string;
  /** Ends after Thinking, finishing with no title or prompt. */
  settingsOnly?: boolean;
  /**
   * Listed first (so selected) and marked "last used": the provider, and, for that
   * provider only, its model and thinking level.
   */
  last?: LastConfiguration | null;
}
export interface LastConfiguration {
  provider: string;
  model: string;
  thinkingOptionId: string | null;
}
function first<T>(items: readonly T[], isLast: (item: T) => boolean): T[] {
  return items.toSorted((a, b) => Number(isLast(b)) - Number(isLast(a)));
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
  options: ConfigurationOptions = {},
): CommandStep {
  function providerStep(cwd: string): CommandStep {
    const step: CommandStep = {
      kind: "choice",
      title: "Provider",
      loading: "Loading providers…",
      ...(deps.onProvidersChange
        ? { subscribe: deps.onProvidersChange.bind(deps) }
        : {}),
      items: async () =>
        first(
          await deps.providers(),
          (provider) => provider.id === options.last?.provider,
        ).map((provider) => ({
          id: `provider:${provider.id}`,
          group: "Agents",
          title: provider.label,
          subtitle:
            provider.error ??
            (provider.id === options.last?.provider ? "last used" : ""),
          run: () => (provider.available ? modelStep(cwd, provider) : step),
        })),
    };
    return step;
  }
  /** The last configuration, only when it was for this provider. */
  function lastFor(provider: string) {
    return options.last?.provider === provider ? options.last : null;
  }
  function modelStep(cwd: string, provider: CatalogProvider): CommandStep {
    const lastModel = lastFor(provider.id)?.model;
    return {
      kind: "choice",
      title: "Model",
      items: async () =>
        first(
          first(await deps.models(provider.id), (model) => model.isDefault),
          (model) => model.id === lastModel,
        ).map((model) => ({
          id: `model:${model.id}`,
          group: "Agents",
          title: model.label,
          subtitle: [
            model.description,
            model.isDefault ? "default" : null,
            model.id === lastModel ? "last used" : null,
          ]
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
  ): CommandStep | undefined {
    const thinking = model.thinking;
    if (!thinking) return titleStep(cwd, provider, model.id, modeId);
    return {
      kind: "choice",
      title: "Thinking",
      items: () => {
        if (thinking.kind === "unsupported") throw Error(thinking.message);
        const lastId = lastFor(provider)?.thinkingOptionId;
        const last = thinking.options.some((option) => option.id === lastId)
          ? lastId
          : null;
        const preferred = last ?? deps.thinkingPreference?.get() ?? "medium";
        return first(thinking.options, (option) => option.id === preferred).map(
          (option) => ({
            id: `thinking:${option.id}`,
            group: "Agents",
            title: option.label,
            subtitle: [
              option.description,
              option.id === preferred ? (last ? "last used" : "default") : null,
            ]
              .filter(Boolean)
              .join(" · "),
            run: () => {
              deps.thinkingPreference?.set(option.id);
              return titleStep(cwd, provider, model.id, modeId, option.id);
            },
          }),
        );
      },
    };
  }
  function titleStep(
    cwd: string,
    provider: string,
    model: string,
    modeId: string | null,
    thinkingOptionId?: string,
  ): CommandStep | undefined {
    if (options.settingsOnly)
      return finish({
        provider,
        model,
        modeId,
        ...(thinkingOptionId !== undefined ? { thinkingOptionId } : {}),
        cwd,
        title: null,
        prompt: null,
      });
    return {
      kind: "input",
      title: "Title",
      placeholder: options.titlePlaceholder ?? "Agent title (optional)",
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
          ...(deps.completions ? { port: deps.completions } : {}),
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
  function configured(workspace: WorkspaceTarget) {
    return agentConfigurationStep(deps, workspace.cwd, (input) => {
      const create = () => deps.create(workspace.key, input);
      void (
        deps.thinkingPreference
          ? deps.thinkingPreference.flush().then(create)
          : create()
      ).then(deps.opened, (error: unknown) =>
        deps.failed(error instanceof Error ? error.message : String(error)),
      );
    });
  }
  if (deps.defaultWorkspace) return configured(deps.defaultWorkspace);
  return {
    kind: "choice",
    title: "Workspace",
    items: () =>
      deps.workspaces.map((workspace) => ({
        id: `workspace:${workspace.key}`,
        group: "Workspaces",
        title: workspace.label,
        subtitle: workspace.cwd,
        run: () => configured(workspace),
      })),
  };
}
