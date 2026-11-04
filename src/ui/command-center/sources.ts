import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceGroup } from "../../state/agents-store.js";
import type { CatalogModel } from "../../state/ports.js";
import type { TimelineStore } from "../App.js";
import { agentName, shortPath } from "../agent-display.js";
import { type Action, BINDINGS, helpRows } from "../input/keymap.js";
import { assign, type Layout, split } from "../layout/split-tree.js";
import { type CreateDeps, createAgentStep } from "./create-agent.js";
import type { CommandItem, CommandSource } from "./registry.js";
export interface BuiltinContext {
  groups: readonly WorkspaceGroup[];
  focusedAgent: PaseoAgent | undefined;
  prefixLabel: string;
  focusedStore: TimelineStore | null;
  createAgent?: CreateDeps;
  models?(provider: string): Promise<CatalogModel[]>;
  open(agent: PaseoAgent): void;
  changeLayout(change: (layout: Layout) => Layout): void;
  workspace(agentId: string): void;
  act(action: Action): void;
}
export function builtinSource(context: BuiltinContext): CommandSource {
  return {
    id: "builtin",
    items() {
      const items: CommandItem[] = [];
      for (const group of context.groups) {
        for (const agent of group.agents) {
          const title = agentName(agent);
          const subtitle = `${agent.provider} · ${agent.status} · ${shortPath(agent.cwd)}`;
          items.push({
            id: `agent:${agent.id}`,
            group: "Agents",
            title,
            subtitle,
            recency: Date.parse(agent.updatedAt),
            run(): undefined {
              context.open(agent);
            },
          });
          items.push({
            id: `agent:${agent.id}:split`,
            group: "Agents",
            title: `Open ${title} in split right`,
            subtitle,
            run(): undefined {
              context.changeLayout((layout) =>
                assign(split(layout, "right"), agent.id),
              );
            },
          });
        }
        const first = group.agents[0];
        if (first)
          items.push({
            id: `workspace:${group.key}`,
            group: "Workspaces",
            title: shortPath(first.cwd),
            subtitle: group.key,
            run(): undefined {
              context.workspace(first.id);
            },
          });
      }
      const createAgent = context.createAgent;
      if (createAgent)
        items.push({
          id: "new-agent",
          group: "Agents",
          title: "New agent…",
          keywords: ["create", "new"],
          run: () => createAgentStep(createAgent),
        });
      items.push(...agentCommands(context));
      for (const binding of BINDINGS) {
        if (
          binding.modes.includes("prefix") &&
          ["pane.split", "pane.close", "pane.zoom", "pane.next"].includes(
            binding.action.type,
          )
        )
          items.push({
            id: `pane:${binding.keys}`,
            group: "Panes",
            title: binding.description,
            shortcut: `${context.prefixLabel} ${binding.keys}`,
            run(): undefined {
              context.act(binding.action);
            },
          });
      }
      items.push(
        {
          id: "sidebar",
          group: "View",
          title: "Toggle sidebar",
          run(): undefined {
            context.act({ type: "sidebar.toggle" });
          },
        },
        {
          id: "help",
          group: "View",
          title: "Keyboard shortcuts",
          run(): undefined {
            context.act({ type: "help" });
          },
        },
      );
      if (context.focusedAgent) {
        if (context.focusedAgent.status === "running")
          items.push({
            id: "stop",
            group: "View",
            title: "Stop turn",
            shortcut: "Ctrl-X",
            run(): undefined {
              context.act({ type: "stop" });
            },
          });
        items.push(
          {
            id: "expand-all",
            group: "View",
            title: "Expand all",
            run(): undefined {
              context.act({ type: "block.expandAll" });
            },
          },
          {
            id: "collapse-all",
            group: "View",
            title: "Collapse all",
            run(): undefined {
              context.act({ type: "block.collapseAll" });
            },
          },
        );
      }
      for (const [index, row] of helpRows(context.prefixLabel).entries())
        items.push({
          id: `help:${index}`,
          group: "Help",
          title: row.description,
          subtitle: row.section,
          shortcut: row.keys,
          run(): undefined {
            context.act({ type: "help" });
          },
        });
      return items;
    },
  };
}

function agentCommands(context: BuiltinContext): CommandItem[] {
  const items: CommandItem[] = [];
  const agent = context.focusedAgent,
    store = context.focusedStore;
  if (agent && store) {
    if (agent.availableModes.length >= 2)
      items.push({
        id: "set-mode",
        group: "Agent",
        title: "Set mode…",
        shortcut: "Shift-Tab",
        run: () => ({
          kind: "choice",
          title: "Set mode",
          items: () =>
            agent.availableModes.map((mode) => ({
              id: `mode:${mode.id}`,
              group: "Agent",
              title: mode.label,
              subtitle: [
                mode.description,
                mode.id === agent.currentModeId ? "current" : null,
              ]
                .filter(Boolean)
                .join(" · "),
              run(): undefined {
                void store.setMode(mode.id);
              },
            })),
        }),
      });
    const models = context.models;
    if (models)
      items.push({
        id: "set-model",
        group: "Agent",
        title: "Set model…",
        run: () => ({
          kind: "choice",
          title: "Set model",
          items: async () =>
            (await models(agent.provider)).map((model) => ({
              id: `model:${model.id}`,
              group: "Agent",
              title: model.label,
              subtitle: [
                model.description,
                model.id === agent.model ? "current" : null,
                model.isDefault ? "default" : null,
              ]
                .filter(Boolean)
                .join(" · "),
              run(): undefined {
                void store.setModel(model.id);
              },
            })),
        }),
      });
    items.push(
      {
        id: "rename",
        group: "Agent",
        title: "Rename…",
        run: () => ({
          kind: "input",
          title: "Rename",
          placeholder: "Agent name",
          initial: agentName(agent),
          submit(text): undefined {
            void store.rename(text);
          },
        }),
      },
      {
        id: "archive",
        group: "Agent",
        title: "Archive…",
        run: () => ({
          kind: "confirm",
          title: `Archive ${agentName(agent)}?`,
          confirm() {
            void store.archive();
          },
        }),
      },
    );
  }
  return items;
}
