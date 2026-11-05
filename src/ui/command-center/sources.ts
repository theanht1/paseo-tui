import { posix } from "node:path";
import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceGroup } from "../../state/agents-store.js";
import type { CatalogModel } from "../../state/ports.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import { agentName, shortPath } from "../agent/agent-display.js";
import type { FileLink } from "../file-links/links.js";
import { type Action, paletteActions } from "../input/keymap.js";
import { assign, type Layout, split } from "../layout/split-tree.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { type CreateDeps, createAgentStep } from "./create-agent.js";
import type { CommandItem, CommandSource } from "./registry.js";
export interface BuiltinContext {
  groups: readonly WorkspaceGroup[];
  workspaces: readonly WorkspaceRow[];
  focusedAgent: PaseoAgent | undefined;
  prefixLabel: string;
  focusedStore: TimelineStore | null;
  createAgent?: CreateDeps;
  models?(provider: string): Promise<CatalogModel[]>;
  open(agent: PaseoAgent): void;
  changeLayout(change: (layout: Layout) => Layout): void;
  workspace(workspace: WorkspaceRow): void;
  act(action: Action): void;
  /** Files mentioned in the focused chat, most recent first. */
  files?: { list(): readonly FileLink[]; open(link: FileLink): void };
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
      }
      for (const workspace of context.workspaces) {
        items.push({
          id: `workspace:${workspace.id}`,
          group: "Workspaces",
          title: workspace.title || workspace.name,
          subtitle: workspace.workspaceDirectory ?? workspace.projectRootPath,
          run(): undefined {
            context.workspace(workspace);
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
      items.push(...agentCommands(context), ...fileCommands(context));
      for (const entry of paletteActions(context.prefixLabel))
        items.push({
          id: `action:${JSON.stringify(entry.action)}`,
          group: "Actions",
          title: entry.title,
          shortcut: entry.shortcut,
          run(): undefined {
            context.act(entry.action);
          },
        });
      if (context.focusedAgent) {
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

function fileTitle(link: FileLink, cwd: string) {
  const relative = posix.relative(cwd, link.path);
  const name =
    relative && !relative.startsWith("..") && !posix.isAbsolute(relative)
      ? relative
      : shortPath(link.path);
  return link.line === null ? name : `${name}:${link.line}`;
}
function fileCommands(context: BuiltinContext): CommandItem[] {
  const { files, focusedAgent: agent } = context;
  if (!files || !agent) return [];
  return [
    {
      id: "open-chat-file",
      group: "Agent",
      title: "Open file from this chat…",
      keywords: ["vim", "edit", "path"],
      shortcut: "F",
      run: () => ({
        kind: "choice",
        title: "Open file",
        items: () =>
          files.list().map((link, index) => ({
            id: `chat-file:${index}:${link.path}:${link.line ?? ""}`,
            group: "Agent",
            title: fileTitle(link, agent.cwd),
            subtitle: link.path,
            run(): undefined {
              files.open(link);
            },
          })),
      }),
    },
  ];
}
