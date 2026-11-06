import type { ConnectionState, PaseoAgent, PaseoApi } from "@getpaseo/client";
import type {
  CompletionPort,
  DirectoryPort,
  HistoryPage,
  HistoryPort,
  SchedulePort,
  TerminalStreamPort,
} from "./connection/ports.js";
import type { LiveHost } from "./hosts.js";
import type { AgentsSnapshot, WorkspaceGroup } from "./state/agents-store.js";
import { combineStores } from "./state/combine.js";
import type { AgentsPort } from "./state/ports.js";
import type { ProviderSubagentStore } from "./state/provider-subagents.js";
import { createTimelineRegistry } from "./state/timeline-registry.js";
import type { TimelineStore } from "./state/timeline-store.js";
import type { UsageStore } from "./state/usage-store.js";
import { mergeHosts } from "./ui/hosts/merge.js";
import type { ExternalStore } from "./ui/use-store.js";
import type { WorkspaceActions } from "./ui/workspace/workspace-actions.js";
import type { DirectorySnapshot } from "./ui/workspace/workspace-directory.js";
import type { WorkspaceTab } from "./ui/workspace/workspaces.js";

/** What the merged window needs from one host's session. */
export interface HostSession {
  status: ExternalStore<ConnectionState>;
  agents: ExternalStore<AgentsSnapshot>;
  directory: ExternalStore<DirectorySnapshot>;
  terminals: Pick<PaseoApi["terminals"], "ref">;
  terminalStream: TerminalStreamPort;
  management: WorkspaceActions;
  agentsPort: Pick<AgentsPort, "providers" | "models" | "modes" | "create">;
  clearAttention(agentId: string): Promise<void>;
  refresh(): Promise<void>;
  openTimeline(agent: PaseoAgent): TimelineStore;
  completions: CompletionPort;
  directories: DirectoryPort;
  subagents?: ProviderSubagentStore | undefined;
  usage?: UsageStore | undefined;
  history?: HistoryPort | undefined;
  schedules: SchedulePort;
}
type Host = LiveHost<{ session: HostSession }>;
const NO_DESCRIPTORS: ExternalStore<
  ReturnType<ProviderSubagentStore["getSnapshot"]>
> = { subscribe: () => () => {}, getSnapshot: () => [] };

function byRecency(left: WorkspaceGroup, right: WorkspaceGroup) {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.key.localeCompare(right.key)
  );
}
function errors(
  values: readonly { source: Host; value: { error: string | null } }[],
) {
  const failed = values.flatMap(({ source, value }) =>
    value.error ? [`${source.label}: ${value.error}`] : [],
  );
  return failed.length ? failed.join("; ") : null;
}

/** Host ids (see hosts.ts) of daemons on this machine: a Paseo home, or a loopback address. */
const LOCAL_HOST =
  /^home(:|$)|^host:(unix:|pipe:|[a-z]+:\/\/(localhost|127\.|\[::1\]))/;
/** The status bar name: the startup host's, plus how many others are connected. */
export function windowLabel(
  hosts: readonly LiveHost<{ connection: { label: string } }>[],
) {
  const [first, ...others] = hosts;
  const label = first?.live.connection.label ?? "no host";
  return others.length
    ? `${label} +${others.length} host${others.length === 1 ? "" : "s"}`
    : label;
}
/**
 * Every connected host as one window, the desktop app's way: their agents,
 * projects (merged by repository) and workspaces in one list, and each action sent
 * to the host that owns its agent, workspace or terminal. Things with no owner
 * (directory search, slash commands, file links, new agents) go to the host of the
 * focused workspace; usage and schedules come from the first (startup) host.
 */
export function createMultiHost(hosts: ExternalStore<readonly Host[]>) {
  const list = () => hosts.getSnapshot();
  const first = () => {
    const host = list()[0];
    if (!host) throw Error("No host is connected");
    return host;
  };
  /** Ids already seen per host; agent, workspace and terminal ids are unique across hosts. */
  const owners = new Map<string, Host>();
  let focused: string | null = null;

  const agents = combineStores({
    sources: hosts,
    store: (host: Host) => host.live.session.agents,
    merge(values): AgentsSnapshot {
      for (const { source, value } of values)
        for (const group of value.groups)
          for (const agent of group.agents) owners.set(agent.id, source);
      return {
        groups: values.flatMap(({ value }) => value.groups).sort(byRecency),
        error: errors(values),
      };
    },
  });
  const directory = combineStores({
    sources: hosts,
    store: (host: Host) => host.live.session.directory,
    merge(values): DirectorySnapshot {
      for (const { source, value } of values) {
        for (const workspace of value.workspaces)
          owners.set(workspace.id, source);
        for (const terminal of value.terminals) owners.set(terminal.id, source);
      }
      const merged = mergeHosts(
        values.map(({ source, value }) => ({
          hostId: source.id,
          label: source.label,
          projects: value.projects,
          workspaces: value.workspaces,
        })),
      );
      const labels = new Map(
        values.map(({ source }) => [source.id, source.label]),
      );
      return {
        projects: merged.projects,
        workspaces: merged.workspaces,
        terminals: values.flatMap(({ value }) => value.terminals),
        error: errors(values),
        ...(values.length > 1
          ? {
              hosts: {
                labels: new Map(
                  [...merged.workspaceHosts].map(([workspace, host]) => [
                    workspace,
                    labels.get(host) ?? host,
                  ]),
                ),
                placements: merged.placements,
              },
            }
          : {}),
      };
    },
  });
  const descriptors = combineStores({
    sources: hosts,
    store: (host: Host) => host.live.session.subagents ?? NO_DESCRIPTORS,
    merge: (values) => values.flatMap(({ value }) => value),
  });

  function find(id: string): Host | null {
    const known = owners.get(id);
    if (known && list().includes(known)) return known;
    agents.getSnapshot();
    directory.getSnapshot();
    const found = owners.get(id);
    return found && list().includes(found) ? found : null;
  }
  function owner(id: string): Host {
    const host = find(id);
    if (!host) throw Error("That item's host is not connected");
    return host;
  }
  function owned<T extends { id: string }>(host: Host, value: T): T {
    owners.set(value.id, host);
    return value;
  }
  function historyHosts() {
    return list().flatMap((host) => {
      const port = host.live.session.history;
      return port ? [{ host, port }] : [];
    });
  }
  function current(): Host {
    return (focused ? find(focused) : null) ?? first();
  }
  function tabOwner(tab: WorkspaceTab): Host {
    if (tab.kind === "agent") return owner(tab.agent.id);
    if (tab.kind === "terminal") return owner(tab.terminal.id);
    return owner(tab.workspaceId);
  }
  /** The host and its own project behind a merged (or a host's) project. */
  function projectOwners(projectId: string) {
    const placements = directory.getSnapshot().hosts?.placements.get(projectId);
    if (placements)
      return placements.flatMap((placement) => {
        const host = list().find(
          (candidate) => candidate.id === placement.hostId,
        );
        return host ? [{ host, project: placement.project }] : [];
      });
    return list().flatMap((host) => {
      const project = host.live.session.directory
        .getSnapshot()
        .projects.find((candidate) => candidate.projectId === projectId);
      return project ? [{ host, project }] : [];
    });
  }
  function projectOwner(projectId: string) {
    const found = projectOwners(projectId)[0];
    if (!found) throw Error("That project's host is not connected");
    return found;
  }
  const history = {
    get searchable() {
      return historyHosts().some(({ port }) => port.searchable);
    },
    async list(query: string): Promise<HistoryPage & { hostErrors: string[] }> {
      const searching = query.trim() !== "";
      const results = await Promise.all(
        historyHosts().map(async ({ host, port }) => {
          // A host that can't search would answer with its newest sessions instead.
          if (searching && !port.searchable)
            return {
              host,
              page: null,
              error: `${host.label}: search needs a newer daemon (agentHistorySearch)`,
            };
          try {
            return { host, page: await port.list(query), error: null };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            return { host, page: null, error: `${host.label}: ${message}` };
          }
        }),
      );
      const entries = results.flatMap(({ host, page }) =>
        (page?.entries ?? []).map((entry) => {
          owned(host, entry.agent);
          return entry;
        }),
      );
      entries.sort(
        (left, right) =>
          Date.parse(right.agent.updatedAt) -
            Date.parse(left.agent.updatedAt) ||
          left.agent.id.localeCompare(right.agent.id),
      );
      return {
        entries,
        truncated: results.some(({ page }) => page?.truncated === true),
        hostErrors: results.flatMap(({ error }) => (error ? [error] : [])),
      };
    },
    async unarchive(agentId: string) {
      const port = owner(agentId).live.session.history;
      if (!port) throw Error("This agent's host has no history");
      return port.unarchive(agentId);
    },
  };
  const actions = (host: Host) => host.live.session.management;

  const management: WorkspaceActions = {
    baseBranches(project) {
      const { host, project: own } = projectOwner(project.projectId);
      return actions(host).baseBranches(own);
    },
    async createWorkspace(project, input, placement) {
      const { host, project: own } = projectOwner(project.projectId);
      const result = await actions(host).createWorkspace(own, input, placement);
      owned(host, result.workspace);
      if (result.agent) owned(host, result.agent);
      return result;
    },
    async createAgent(workspace, input) {
      const host = owner(workspace.id);
      return owned(host, await actions(host).createAgent(workspace, input));
    },
    async createTerminal(workspace) {
      const host = owner(workspace.id);
      return owned(host, await actions(host).createTerminal(workspace));
    },
    async openFile(workspace, editor) {
      const host = owner(workspace.id);
      return owned(host, await actions(host).openFile(workspace, editor));
    },
    renameWorkspace: (workspace, title) =>
      actions(owner(workspace.id)).renameWorkspace(workspace, title),
    renameTab: (tab, title) => actions(tabOwner(tab)).renameTab(tab, title),
    closeTab: (tab) => actions(tabOwner(tab)).closeTab(tab),
    directories: (query) => actions(current()).directories(query),
    addProject: (cwd) => actions(current()).addProject(cwd),
    async removeProject(project, workspaces) {
      for (const { host, project: own } of projectOwners(project.projectId))
        await actions(host).removeProject(
          own,
          workspaces.filter((workspace) => find(workspace.id) === host),
        );
    },
    archiveWorkspace: (workspace) =>
      actions(owner(workspace.id)).archiveWorkspace(workspace),
  };

  const catalog = {
    providers: () => current().live.session.agentsPort.providers(),
    models: (provider: string) =>
      current().live.session.agentsPort.models(provider),
    modes: (provider: string) =>
      current().live.session.agentsPort.modes(provider),
    async create(input: Parameters<AgentsPort["create"]>[0]) {
      const host = current();
      return owned(host, await host.live.session.agentsPort.create(input));
    },
  };
  const stream = (id: string) => owner(id).live.session.terminalStream;
  const terminalStream: TerminalStreamPort = {
    observe: (id, receive, onError, onExit) =>
      stream(id).observe(id, receive, onError, onExit),
    write: (id, data) => stream(id).write(id, data),
    resize: (id, cols, rows) => stream(id).resize(id, cols, rows),
  };
  function subagentsOf(parentAgentId: string) {
    const store = owner(parentAgentId).live.session.subagents;
    if (!store) throw Error("This agent's host has no provider subagents");
    return store;
  }
  const subagents = {
    subscribe: descriptors.subscribe,
    getSnapshot: descriptors.getSnapshot,
    track(parentAgentId: string) {
      const host = find(parentAgentId);
      host?.live.session.subagents?.track(parentAgentId);
    },
    timelinePort: (parentAgentId: string, subagentId: string) =>
      subagentsOf(parentAgentId).timelinePort(parentAgentId, subagentId),
  };

  return {
    agents,
    directory,
    management,
    catalog,
    terminalStream,
    subagents,
    terminals: {
      ref: (id: string) => owner(id).live.session.terminals.ref(id),
    } satisfies HostSession["terminals"],
    timelines: createTimelineRegistry((agent) =>
      owner(agent.id).live.session.openTimeline(agent),
    ),
    completions: {
      commands: (source) => current().live.session.completions.commands(source),
      files: (cwd, query) =>
        current().live.session.completions.files(cwd, query),
    } satisfies CompletionPort,
    directories: {
      list: (path) => current().live.session.directories.list(path),
    } satisfies DirectoryPort,
    get history() {
      return historyHosts().length ? history : null;
    },
    clearAttention: (agentId: string) =>
      owner(agentId).live.session.clearAttention(agentId),
    /** The agent's host is reached over the network rather than this machine's Paseo home. */
    isRemoteAgent(agentId: string) {
      const host = find(agentId);
      return host !== null && !LOCAL_HOST.test(host.id);
    },
    async refresh() {
      await Promise.all(list().map((host) => host.live.session.refresh()));
    },
    /** The workspace the window shows; host-less requests go to its host. */
    focus(workspaceId: string | null) {
      focused = workspaceId;
    },
    /** The startup host's: the connection status, usage and schedules. */
    get local() {
      return first().live.session;
    },
  };
}
