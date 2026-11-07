import { posix } from "node:path";
import type { PaseoAgent } from "@getpaseo/client";
import type { WorkspaceGroup } from "../../state/agents-store.js";
import type { HostHealthEntry } from "../../state/host-health.js";
import type { CatalogModel } from "../../state/ports.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import { agentName, shortPath } from "../agent/agent-display.js";
import { viewOnlyCommands } from "../agent/archived-views.js";
import { type ClearedUsage, usageSinceClear } from "../agent/clear-session.js";
import {
  contextDetailRows,
  contextMeterText,
  contextWindow,
} from "../agent/context-window.js";
import type { ReadAction } from "../agent/read-state.js";
import type { UsageConfig } from "../config/user-config.js";
import type { FileLink } from "../file-links/links.js";
import { type Action, type Binding, paletteActions } from "../input/keymap.js";
import { assign, type Layout, split } from "../layout/split-tree.js";
import type { AgentSeed } from "../management-controller.js";
import {
  type ScheduleDeps,
  scheduleCommands,
} from "../schedules/schedule-commands.js";
import { type UsageSource, usageCommands } from "../usage/usage-commands.js";
import type { ExternalStore } from "../use-store.js";
import type { WorkspaceRow } from "../workspace/workspaces.js";
import { historyCommands } from "./agent-history.js";
import { type CreateDeps, createAgentStep } from "./create-agent.js";
import { type LabelCommandContext, labelCommands } from "./label-commands.js";
import { type PathContext, pathCommands } from "./path-commands.js";
import { type PinContext, pinCommands } from "./pin-commands.js";
import type { CommandItem, CommandSource, CommandStep } from "./registry.js";
import {
  type SessionHistoryContext,
  sessionHistoryCommand,
} from "./session-history.js";
import { type Versions, versionRows } from "./version.js";
export interface BuiltinContext {
  version?: {
    versions: Versions;
    hosts: ExternalStore<readonly HostHealthEntry[]>;
  };
  groups: readonly WorkspaceGroup[];
  /** Agents waiting on you, most urgent first, with what each waits on. */
  waiting: readonly { agent: PaseoAgent; reason: string }[];
  workspaces: readonly WorkspaceRow[];
  focusedAgent: PaseoAgent | undefined;
  prefixLabel: string;
  /** The effective key table; defaults to the built-in bindings. */
  bindings?: readonly Binding[];
  focusedStore: TimelineStore | null;
  /** Messages queued for the focused agent's running turn. */
  queued?: number;
  createAgent?: CreateDeps;
  models?(provider: string): Promise<CatalogModel[]>;
  open(agent: PaseoAgent): void;
  changeLayout(change: (layout: Layout) => Layout): void;
  workspace(workspace: WorkspaceRow): void;
  act(action: Action): void;
  /** Files mentioned in the focused chat, most recent first. */
  files?: { list(): readonly FileLink[]; open(link: FileLink): void };
  /** Daemon schedules: browse, inspect, pause/resume, run, delete, create. */
  schedules?: ScheduleDeps;
  /** Provider usage reports; absent when the daemon reports no usage. */
  usage?: UsageSource;
  usageConfig?: UsageConfig;
  /** Why usage and schedules can't be read now (the startup host is offline). */
  unavailable?: () => string | null;
  /** The open workspace's directory and editor tab's file, to copy. */
  paths?: PathContext;
  /** Mark as read / unread for the selected workspace, and Mark all as read. */
  read?: ReadContext;
  /** Pin workspace / Unpin workspace for the selected workspace. */
  pins?: PinContext;
  /** Labels… for the selected workspace and Filter by label…. */
  labels?: LabelCommandContext;
  /** Workspace, project and host management (each opens its own dialog). */
  manage?: ManageCommands;
  /** Past sessions (History…); absent when no host serves history. */
  history?: SessionHistoryContext;
  /** Unarchives the focused agent; offered while it is archived. */
  unarchive?(): void;
  /** Confirms and clears the focused agent's session; absent when it has no /clear command. */
  clear?: CommandStep;
  /** The focused agent's usage at its last clear; the context window row ignores older usage. */
  clearedUsage?: ClearedUsage;
  /** Scrolls the focused pane to a prompt (Jump to prompt…). */
  goto?(epoch: string, seq: number): void;
  /** Asks the hosts to rediscover their providers (Refresh providers). */
  refreshProviders?(): void;
}
export interface ReadContext {
  workspace: WorkspaceRow | null;
  action: ReadAction | null;
  unread: number;
  mark(workspace: WorkspaceRow, kind: ReadAction["kind"]): void;
  markAll(): void;
}
function readCommands({
  workspace,
  action,
  unread,
  mark,
  markAll,
}: ReadContext): CommandItem[] {
  const items: CommandItem[] = [];
  if (workspace && action)
    items.push({
      id: `mark-${action.kind}`,
      group: "Workspaces",
      title: action.title,
      subtitle: workspace.title || workspace.name,
      keywords: ["read", "unread", "seen", "acknowledge"],
      run(): undefined {
        mark(workspace, action.kind);
      },
    });
  if (unread > 0)
    items.push({
      id: "mark-all-read",
      group: "Workspaces",
      title: "Mark all as read",
      subtitle: `${unread} unread`,
      keywords: ["read", "seen", "acknowledge", "clear"],
      run(): undefined {
        markAll();
      },
    });
  return items;
}
export interface ManageCommands {
  /** The open workspace, which Archive workspace… archives. */
  workspace: WorkspaceRow | null;
  /** Hosts can be listed and added. */
  hosts: boolean;
  archiveWorkspace(workspace: WorkspaceRow): void;
  addProject(): void;
  listProjects(): void;
  removeProject(): void;
  listHosts(): void;
  addHost(): void;
  /** The New workspace steps for Fork into a new workspace. */
  forkWorkspace(seed: AgentSeed): CommandStep;
}
function manageCommands(manage: ManageCommands): CommandItem[] {
  const item = (
    id: string,
    title: string,
    subtitle: string,
    keywords: readonly string[],
    run: () => void,
  ): CommandItem => ({
    id,
    group: "Workspaces",
    title,
    subtitle,
    keywords,
    run(): undefined {
      run();
    },
  });
  const { workspace } = manage;
  return [
    ...(workspace
      ? [
          item(
            "archive-workspace",
            "Archive workspace…",
            workspace.title || workspace.name,
            ["archive", "remove", "close"],
            () => manage.archiveWorkspace(workspace),
          ),
        ]
      : []),
    item(
      "add-project",
      "Add project…",
      "Find a directory on a host",
      ["project", "new", "open", "folder", "repository"],
      manage.addProject,
    ),
    item(
      "list-projects",
      "Projects…",
      "This host's projects: new workspace or remove",
      ["project", "list"],
      manage.listProjects,
    ),
    item(
      "remove-project",
      "Remove project…",
      "Archive its workspaces and delete their worktrees",
      ["project", "delete", "archive"],
      manage.removeProject,
    ),
    ...(manage.hosts
      ? [
          item(
            "list-hosts",
            "Hosts…",
            "Switch to another Paseo daemon",
            ["host", "server", "daemon", "switch", "remote"],
            manage.listHosts,
          ),
          item(
            "add-host",
            "Add host…",
            "Connect to another Paseo daemon",
            ["host", "server", "daemon", "remote", "ssh"],
            manage.addHost,
          ),
        ]
      : []),
  ];
}
export function builtinSource(context: BuiltinContext): CommandSource {
  return {
    id: "builtin",
    items() {
      const items: CommandItem[] = context.waiting.map(
        ({ agent, reason }, index) => ({
          id: `waiting:${agent.id}`,
          group: "Needs you",
          title: agentName(agent),
          subtitle: `${reason} · ${shortPath(agent.cwd)}`,
          keywords: ["attention", "inbox", "unread"],
          recency: context.waiting.length - index,
          run(): undefined {
            context.open(agent);
          },
        }),
      );
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
      if (context.history) items.push(sessionHistoryCommand(context.history));
      items.push(...agentCommands(context), ...fileCommands(context));
      if (context.paths) items.push(...pathCommands(context.paths));
      if (context.manage) items.push(...manageCommands(context.manage));
      if (context.read) items.push(...readCommands(context.read));
      if (context.pins) items.push(...pinCommands(context.pins));
      if (context.labels) items.push(...labelCommands(context.labels));
      if (context.schedules) items.push(...scheduleCommands(context.schedules));
      if (context.usage)
        items.push(
          ...usageCommands(
            context.usage,
            Date.now,
            context.usageConfig,
            context.unavailable,
          ),
        );
      for (const entry of paletteActions(context.prefixLabel, context.bindings))
        items.push({
          id: `action:${JSON.stringify(entry.action)}`,
          group: "Actions",
          title: entry.title,
          action: entry.action,
          keywords: entry.keywords,
          run(): undefined {
            context.act(entry.action);
          },
        });
      const version = context.version;
      if (version) {
        const step: CommandStep = {
          kind: "readOnly",
          title: "Version",
          subscribe: version.hosts.subscribe,
          lines: () =>
            versionRows(version.versions, version.hosts.getSnapshot()),
        };
        items.push({
          id: "version",
          group: "View",
          title: "Version",
          run: () => step,
        });
      }
      const refreshProviders = context.refreshProviders;
      if (refreshProviders)
        items.push({
          id: "refresh-providers",
          group: "Actions",
          title: "Refresh providers",
          keywords: ["providers", "models", "reload", "rediscover"],
          run(): undefined {
            refreshProviders();
          },
        });
      if (context.focusedAgent && context.queued)
        items.push(...queueCommands(context.queued, context.act));
      if (context.focusedAgent) {
        items.push(
          {
            id: "expand-all",
            group: "View",
            title: "Expand all",
            action: { type: "block.expandAll" },
            run(): undefined {
              context.act({ type: "block.expandAll" });
            },
          },
          {
            id: "collapse-all",
            group: "View",
            title: "Collapse all",
            action: { type: "block.collapseAll" },
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

/** The focused agent's message queue; each runs the same action as its key. */
function queueCommands(
  count: number,
  act: (action: Action) => void,
): CommandItem[] {
  const subtitle = `${count} queued message${count === 1 ? "" : "s"}`;
  return (
    [
      ["queue-send", "Send queued message now", { type: "queue.send" }],
      [
        "queue-interrupt",
        "Interrupt and send queued message",
        { type: "queue.interrupt" },
      ],
      ["queue-edit", "Edit queued message", { type: "queue.edit" }],
      ["queue-clear", "Clear message queue", { type: "queue.clear" }],
    ] as const
  ).map(([id, title, action]) => ({
    id,
    group: "Agent",
    title,
    subtitle,
    keywords: ["queue", "pending", "message"],
    action,
    run(): undefined {
      act(action);
    },
  }));
}

function agentCommands(context: BuiltinContext): CommandItem[] {
  const items: CommandItem[] = [];
  const agent = context.focusedAgent,
    store = context.focusedStore;
  const unarchive = context.unarchive;
  if (agent?.archivedAt != null && unarchive)
    items.push({
      id: "unarchive",
      group: "Agent",
      title: "Unarchive",
      action: { type: "agent.unarchive" },
      run(): undefined {
        unarchive();
      },
    });
  if (agent) {
    const window = contextWindow(
      usageSinceClear(agent.lastUsage, context.clearedUsage),
    );
    const step: CommandStep = {
      kind: "choice",
      title: "Context window",
      items: () =>
        contextDetailRows(window).map((row) => ({
          id: `context:${row}`,
          group: "Agent",
          title: row,
          run: () => step,
        })),
    };
    items.push({
      id: "context-window",
      group: "Agent",
      title: "Context window",
      subtitle: contextMeterText(window) || "No context data",
      keywords: ["tokens", "cost", "context"],
      run: () => step,
    });
  }
  if (agent && store) {
    if (agent.availableModes.length >= 2)
      items.push({
        id: "set-mode",
        group: "Agent",
        title: "Set mode…",
        action: { type: "agent.cycleMode" },
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
      ...historyCommands({
        agent,
        store,
        models,
        createAgent: context.createAgent,
        ...(context.goto ? { goto: context.goto } : {}),
        ...(context.manage
          ? { forkWorkspace: context.manage.forkWorkspace }
          : {}),
      }),
    );
    const clear = context.clear;
    if (clear)
      items.push({
        id: "clear-session",
        group: "Agent",
        title: "Clear session",
        keywords: ["reset", "new", "conversation", "context"],
        action: { type: "agent.clear" },
        run: () => clear,
      });
    items.push({
      id: "rename",
      group: "Agent",
      title: "Rename…",
      action: { type: "tab.rename" },
      run: () => ({
        kind: "input",
        title: "Rename",
        placeholder: "Agent name",
        initial: agentName(agent),
        submit(text): undefined {
          void store.rename(text);
        },
      }),
    });
  }
  return agent ? viewOnlyCommands(agent, items) : items;
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
      action: { type: "hint.start" },
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
