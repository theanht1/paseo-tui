import type { PaseoAgent } from "@getpaseo/client";
import type {
  RewindMode,
  TimelinePrompt,
  TimelinePromptIndex,
} from "../../connection/ports.js";
import type { CatalogModel } from "../../state/ports.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import { agentName } from "../agent/agent-display.js";
import type { CreateDeps } from "./create-agent.js";
import type { CommandItem, CommandStep } from "./registry.js";

export interface HistoryCommandContext {
  agent: PaseoAgent;
  store: TimelineStore;
  models?(provider: string): Promise<CatalogModel[]>;
  createAgent?: Pick<CreateDeps, "create" | "opened" | "failed">;
}
/** Set thinking, rewind and fork, each shown only when the daemon and agent support it. */
export function historyCommands(context: HistoryCommandContext): CommandItem[] {
  return [
    thinkingCommand(context),
    rewindCommand(context),
    forkCommand(context),
  ].filter((item) => item !== null);
}

function thinkingCommand({
  agent,
  store,
  models,
}: HistoryCommandContext): CommandItem | null {
  const setThinking = store.setThinking;
  if (!setThinking || !models) return null;
  return {
    id: "set-thinking",
    group: "Agent",
    title: "Set thinking…",
    keywords: ["reasoning", "effort"],
    run: () => ({
      kind: "choice",
      title: "Set thinking",
      async items() {
        const catalog = await models(agent.provider);
        const model = catalog.find((entry) =>
          agent.model ? entry.id === agent.model : entry.isDefault,
        );
        const thinking = model?.thinking;
        if (thinking?.kind === "unsupported") throw Error(thinking.message);
        if (!thinking)
          throw Error(
            `${model?.label ?? agent.model ?? "This model"} has no thinking options`,
          );
        const current =
          agent.thinkingOptionId ?? agent.effectiveThinkingOptionId ?? null;
        return thinking.options.map((option) => ({
          id: `thinking:${option.id}`,
          group: "Agent",
          title: option.label,
          subtitle: [
            option.description,
            option.id === current ? "current" : null,
            option.isDefault ? "default" : null,
          ]
            .filter(Boolean)
            .join(" · "),
          run(): undefined {
            void setThinking(option.id);
          },
        }));
      },
    }),
  };
}

const MODES: readonly {
  mode: RewindMode;
  capability:
    | "supportsRewindConversation"
    | "supportsRewindFiles"
    | "supportsRewindBoth";
  label: string;
}[] = [
  {
    mode: "conversation",
    capability: "supportsRewindConversation",
    label: "Conversation only",
  },
  { mode: "files", capability: "supportsRewindFiles", label: "Files only" },
  {
    mode: "both",
    capability: "supportsRewindBoth",
    label: "Conversation and files",
  },
];
function promptTime(timestamp: string) {
  return timestamp.slice(0, 16).replace("T", " ");
}
/** The agent's prompts, newest first; `run` receives the prompt and whether earlier ones exist. */
function promptStep(
  title: string,
  load: () => Promise<TimelinePromptIndex>,
  run: (
    index: TimelinePromptIndex,
    prompt: TimelinePrompt,
    hasEarlier: boolean,
  ) => CommandStep,
): CommandStep {
  return {
    kind: "choice",
    title,
    async items() {
      const index = await load();
      if (!index.prompts.length) throw Error("This agent has no prompts yet");
      return index.prompts
        .map((prompt, position) => ({
          id: `prompt:${prompt.seq}`,
          group: "Agent" as const,
          title: prompt.preview,
          subtitle: promptTime(prompt.timestamp),
          run: () => run(index, prompt, position > 0),
        }))
        .reverse();
    },
  };
}

function rewindCommand({
  agent,
  store,
}: HistoryCommandContext): CommandItem | null {
  const { prompts, rewind } = store;
  const modes = MODES.filter(
    (entry) => agent.capabilities[entry.capability] === true,
  );
  if (!prompts || !rewind || !modes.length) return null;
  const confirm = (
    index: TimelinePromptIndex,
    prompt: TimelinePrompt,
    mode: (typeof MODES)[number],
  ): CommandStep => ({
    kind: "confirm",
    title: `Rewind ${agentName(agent)} to before “${prompt.preview}” (${mode.label.toLowerCase()})?`,
    confirm() {
      void rewind({ epoch: index.epoch, seq: prompt.seq }, mode.mode);
    },
  });
  return {
    id: "rewind",
    group: "Agent",
    title: "Rewind to prompt…",
    keywords: ["undo", "revert", "checkpoint"],
    run: () =>
      promptStep("Rewind to prompt", prompts, (index, prompt) => {
        const [only] = modes;
        if (only && modes.length === 1) return confirm(index, prompt, only);
        return {
          kind: "choice",
          title: "Rewind",
          items: () =>
            modes.map((mode) => ({
              id: `rewind:${mode.mode}`,
              group: "Agent",
              title: mode.label,
              run: () => confirm(index, prompt, mode),
            })),
        };
      }),
  };
}

function forkCommand({
  agent,
  store,
  createAgent,
}: HistoryCommandContext): CommandItem | null {
  const { prompts, fork } = store;
  const model = agent.model;
  if (!prompts || !fork || !createAgent || !model) return null;
  /** Thinking is copied only when the daemon can set it (`agentThinkingUpdate`). */
  const thinkingOptionId =
    store.setThinking && agent.thinkingOptionId
      ? agent.thinkingOptionId
      : undefined;
  return {
    id: "fork",
    group: "Agent",
    title: "Fork from prompt…",
    keywords: ["branch", "copy"],
    run: () =>
      promptStep("Fork from prompt", prompts, (index, prompt, hasEarlier) => ({
        kind: "input",
        title: "Fork prompt",
        placeholder: "Prompt for the fork (empty resends the chosen prompt)",
        completion: {
          source: {
            kind: "draft",
            config: {
              provider: agent.provider,
              cwd: agent.cwd,
              model,
              ...(agent.currentModeId ? { modeId: agent.currentModeId } : {}),
            },
          },
          cwd: agent.cwd,
        },
        submit(text): undefined {
          void fork({ epoch: index.epoch, seq: prompt.seq }, hasEarlier)
            .then((seed) =>
              createAgent.create({
                provider: agent.provider,
                model,
                modeId: agent.currentModeId,
                ...(thinkingOptionId ? { thinkingOptionId } : {}),
                cwd: agent.cwd,
                title: `Fork of ${agentName(agent)}`,
                prompt: text.trim() ? text : seed.text,
                attachments: seed.attachment ? [seed.attachment] : [],
              }),
            )
            .then(createAgent.opened, (error: unknown) =>
              createAgent.failed(
                error instanceof Error ? error.message : String(error),
              ),
            );
        },
      })),
  };
}
