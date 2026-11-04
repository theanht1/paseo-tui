import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceGroup } from "../../state/agents-store.js";
import { agentName, shortPath } from "../agent-display.js";
import { type Action, BINDINGS, helpRows } from "../input/keymap.js";
import { assign, type Layout, split } from "../layout/split-tree.js";
import type { CommandItem, CommandSource } from "./registry.js";
export interface BuiltinContext {
  groups: readonly WorkspaceGroup[];
  focusedAgent: PaseoAgent | undefined;
  prefixLabel: string;
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
            run() {
              context.open(agent);
            },
          });
          items.push({
            id: `agent:${agent.id}:split`,
            group: "Agents",
            title: `Open ${title} in split right`,
            subtitle,
            run() {
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
            run() {
              context.workspace(first.id);
            },
          });
      }
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
            run() {
              context.act(binding.action);
            },
          });
      }
      items.push(
        {
          id: "sidebar",
          group: "View",
          title: "Toggle sidebar",
          run() {
            context.act({ type: "sidebar.toggle" });
          },
        },
        {
          id: "help",
          group: "View",
          title: "Keyboard shortcuts",
          run() {
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
            run() {
              context.act({ type: "stop" });
            },
          });
        items.push(
          {
            id: "expand-all",
            group: "View",
            title: "Expand all",
            run() {
              context.act({ type: "block.expandAll" });
            },
          },
          {
            id: "collapse-all",
            group: "View",
            title: "Collapse all",
            run() {
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
          run() {
            context.act({ type: "help" });
          },
        });
      return items;
    },
  };
}
