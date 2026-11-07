import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type {
  CompletionPort,
  DirectoryPort,
  HistoryPage,
  HistoryPort,
  HostConnectionState,
  SchedulePort,
  TerminalStreamPort,
  WorkspacePinPort,
  WorkspaceReadPort,
} from "./connection/ports.js";
import type { LiveHost } from "./hosts.js";
import type { AgentsSnapshot, WorkspaceGroup } from "./state/agents-store.js";
import { combineStores } from "./state/combine.js";
import { type HostHealthEntry, hostsSummary } from "./state/host-health.js";
import {
  type HostLabelState,
  type LabelCatalog,
  type WorkspaceLabels,
  workspaceLabelsView,
} from "./state/label-catalog.js";
import type { AgentsPort } from "./state/ports.js";
import type { ProviderSubagentStore } from "./state/provider-subagents.js";
import {
  createTimelineRegistry,
  type TimelineRegistry,
} from "./state/timeline-registry.js";
import type { TimelineStore } from "./state/timeline-store.js";
import type { UsageSnapshot, UsageStore } from "./state/usage-store.js";
import { mergeHosts } from "./ui/hosts/merge.js";
import type { ExternalStore } from "./ui/use-store.js";
import type { WorkspaceActions } from "./ui/workspace/workspace-actions.js";
import type { DirectorySnapshot } from "./ui/workspace/workspace-directory.js";
import type { WorkspaceTab } from "./ui/workspace/workspaces.js";

/** What the merged window needs from one host's session. */
export interface HostSession {
  status: ExternalStore<HostConnectionState>;
  agents: ExternalStore<AgentsSnapshot>;
  directory: ExternalStore<DirectorySnapshot>;
  terminals: Pick<PaseoApi["terminals"], "ref">;
  terminalStream: TerminalStreamPort;
  management: WorkspaceActions;
  agentsPort: Pick<
    AgentsPort,
    "providers" | "models" | "modes" | "onProvidersChange" | "create"
  >;
  refreshProviders(): Promise<void>;
  clearAttention(agentId: string): Promise<void>;
  refresh(): Promise<void>;
  openTimeline(agent: PaseoAgent): TimelineStore;
  completions: CompletionPort;
  directories: DirectoryPort;
  subagents?: ProviderSubagentStore | undefined;
  usage?: UsageStore | undefined;
  history?: HistoryPort | undefined;
  workspaceRead?: WorkspaceReadPort | undefined;
  /** Null when the daemon lacks `workspacePinning`. */
  workspacePins?: WorkspacePinPort | null | undefined;
  schedules: SchedulePort;
  /** Absent when the daemon lacks `workspaceLabels`. */
  labels?: LabelCatalog | undefined;
}
type Host = LiveHost<{ session: HostSession }>;
const UNSUPPORTED_LABELS: HostLabelState = { kind: "unsupported" };
/** A host's label state and whether it is connected, as one store. */
function hostLabelStore(host: Host) {
  const labels = host.live.session.labels;
  const status = host.live.session.status;
  let cached: { online: boolean; state: HostLabelState } | null = null;
  return {
    subscribe(listener: () => void) {
      const stops = [status.subscribe(listener), labels?.subscribe(listener)];
      return () => {
        for (const stop of stops) stop?.();
      };
    },
    getSnapshot() {
      const online = status.getSnapshot().status === "connected";
      const state = labels?.getSnapshot() ?? UNSUPPORTED_LABELS;
      if (cached?.online !== online || cached.state !== state)
        cached = { online, state };
      return cached;
    },
  };
}
const NO_USAGE_SNAPSHOT: UsageSnapshot = { kind: "loading" };
const NO_USAGE: ExternalStore<UsageSnapshot> = {
  subscribe: () => () => {},
  getSnapshot: () => NO_USAGE_SNAPSHOT,
};
const NO_DESCRIPTORS: ExternalStore<
  ReturnType<ProviderSubagentStore["getSnapshot"]>
> = { subscribe: () => () => {}, getSnapshot: () => [] };

function byRecency(left: WorkspaceGroup, right: WorkspaceGroup) {
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
    left.key.localeCompare(right.key)
  );
}
function online(host: Host) {
  return host.live.session.status.getSnapshot().status === "connected";
}
/** Connected hosts' errors; an offline host's failures are its outage, shown once elsewhere. */
function errors(
  values: readonly { source: Host; value: { error: string | null } }[],
) {
  const failed = values.flatMap(({ source, value }) =>
    value.error && online(source) ? [`${source.label}: ${value.error}`] : [],
  );
  return failed.length ? failed.join("; ") : null;
}

/** Host ids (see hosts.ts) of daemons on this machine: a Paseo home, or a loopback address. */
const LOCAL_HOST =
  /^home(:|$)|^host:(unix:|pipe:|[a-z]+:\/\/(localhost|127\.|\[::1\]))/;
/** The status bar name: the startup host's, then how many others there are and are offline. */
export function windowLabel(
  hosts: readonly LiveHost<{ connection: { label: string } }>[],
  health: readonly HostHealthEntry[],
) {
  return `${hosts[0]?.live.connection.label ?? "no host"}${hostsSummary(health)}`;
}
/**
 * Every connected host as one window, the desktop app's way: their agents,
 * projects (merged by repository) and workspaces in one list, and each action sent
 * to the host that owns its agent, workspace or terminal. Things with no owner
 * (directory search, slash commands, file links, new agents) go to the host of the
 * focused workspace; usage and schedules come from the first (startup) host.
 */
export function createMultiHost(
  hosts: ExternalStore<readonly Host[]> & {
    /** Every configured host, connected or not (hosts.ts's health list). */
    health: ExternalStore<readonly { id: string }[]>;
  },
) {
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
  /** Each merged project's per-host projects, whether or not several hosts are connected. */
  let placements: ReturnType<typeof mergeHosts>["placements"] = new Map();
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
      placements = merged.placements;
      const labels = new Map(
        values.map(({ source }) => [source.id, source.label]),
      );
      const offline = values.flatMap(({ source, value }) =>
        online(source) ? [] : value.workspaces.map((workspace) => workspace.id),
      );
      return {
        ...(offline.length ? { offline: new Set(offline) } : {}),
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
  const labelStores = new WeakMap<Host, ReturnType<typeof hostLabelStore>>();
  const hostLabels = combineStores({
    sources: hosts,
    store(host: Host) {
      const known = labelStores.get(host);
      if (known) return known;
      const store = hostLabelStore(host);
      labelStores.set(host, store);
      return store;
    },
    merge: (values) =>
      values.map(({ source, value }) => ({
        id: source.id,
        label: source.label,
        ...value,
      })),
  });
  let labelCache: {
    hosts: ReturnType<typeof hostLabels.getSnapshot>;
    expected: string;
    view: ReturnType<typeof workspaceLabelsView>;
  } | null = null;
  const labelView: ExternalStore<ReturnType<typeof workspaceLabelsView>> = {
    subscribe(listener) {
      const stops = [
        hostLabels.subscribe(listener),
        hosts.health.subscribe(listener),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    getSnapshot() {
      const current = hostLabels.getSnapshot();
      const ids = hosts.health.getSnapshot().map((host) => host.id);
      const expected = ids.join("\n");
      if (labelCache?.hosts !== current || labelCache.expected !== expected)
        labelCache = {
          hosts: current,
          expected,
          view: workspaceLabelsView({
            hosts: current,
            expected: ids,
            hostOf: (workspaceId) => find(workspaceId)?.id ?? null,
          }),
        };
      return labelCache.view;
    },
  };
  function labelCatalog(host: Host): LabelCatalog {
    const catalog = host.live.session.labels;
    if (!catalog)
      throw Error(
        `Update the Paseo daemon on ${host.label} to use workspace labels (workspaceLabels)`,
      );
    return catalog;
  }
  /** The chosen host's catalog; an offline host fails at once. */
  function hostCatalog(hostId: string): LabelCatalog {
    const host = list().find((candidate) => candidate.id === hostId);
    if (!host) throw Error("That host is not connected");
    return labelCatalog(reachable(host));
  }
  const labels: WorkspaceLabels = {
    subscribe: labelView.subscribe,
    getSnapshot: labelView.getSnapshot,
    setAssignment: async (input) =>
      labelCatalog(owner(input.workspaceId)).setAssignment(input),
    update: async (hostId, input) => hostCatalog(hostId).update(input),
    inspectDelete: async (hostId, name) =>
      hostCatalog(hostId).inspectDelete(name),
    delete: async (hostId, name) => hostCatalog(hostId).delete(name),
    reload: async (hostId) => hostCatalog(hostId).load(),
  };
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
  /** The item's host, offline or not: for views that wait for it to come back. */
  function known(id: string): Host {
    const host = find(id);
    if (!host) throw Error("That item's host is not connected");
    return host;
  }
  function reachable(host: Host): Host {
    if (!online(host)) throw Error(`${host.label} is offline`);
    return host;
  }
  /** The item's host for a request; an offline one fails at once instead of waiting. */
  function owner(id: string): Host {
    return reachable(known(id));
  }
  function owned<T extends { id: string }>(host: Host, value: T): T {
    owners.set(value.id, host);
    return value;
  }
  function historyHosts() {
    return list().flatMap((host) => {
      if (!online(host)) return [];
      const port = host.live.session.history;
      return port ? [{ host, port }] : [];
    });
  }
  function current(): Host {
    return reachable((focused ? find(focused) : null) ?? first());
  }
  function tabOwner(tab: WorkspaceTab): Host {
    if (tab.kind === "agent") return owner(tab.agent.id);
    if (tab.kind === "terminal") return owner(tab.terminal.id);
    return owner(tab.workspaceId);
  }
  /** The host and its own project behind a merged (or a host's) project. */
  function projectOwners(projectId: string) {
    directory.getSnapshot();
    const found = placements.get(projectId);
    if (found)
      return found.flatMap((placement) => {
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
  /** An online host of the project; fails fast when every host it is on is offline. */
  function projectOwner(projectId: string) {
    const owners = projectOwners(projectId);
    const found = owners.find(({ host }) => online(host)) ?? owners[0];
    if (!found) throw Error("That project's host is not connected");
    reachable(found.host);
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
  const readPort = (host: Host) => {
    const port = host.live.session.workspaceRead;
    if (!port) throw Error(`${host.label} cannot mark workspaces read`);
    return port;
  };
  const workspaceRead = {
    canMarkUnread(workspaceId: string) {
      const host = find(workspaceId);
      return host?.live.session.workspaceRead?.markUnread != null;
    },
    /** One request per host; online hosts are marked before an offline one is reported. */
    async markRead(workspaceIds: readonly string[]) {
      const grouped = new Map<Host, string[]>();
      for (const id of workspaceIds) {
        const host = known(id);
        grouped.set(host, [...(grouped.get(host) ?? []), id]);
      }
      const hostsInOrder = list().filter((host) => grouped.has(host));
      for (const host of hostsInOrder)
        if (online(host))
          await readPort(host).markRead(grouped.get(host) ?? []);
      const offline = hostsInOrder.filter((host) => !online(host));
      if (offline.length)
        throw Error(
          `${offline.map((host) => host.label).join(", ")} is offline`,
        );
    },
    async markUnread(workspaceId: string) {
      const host = owner(workspaceId);
      const markUnread = readPort(host).markUnread;
      if (!markUnread)
        throw Error(`${host.label} needs a newer daemon (workspaceMarkUnread)`);
      return markUnread(workspaceId);
    },
  };
  const workspacePins = {
    canPin(workspaceId: string) {
      return find(workspaceId)?.live.session.workspacePins != null;
    },
    async setPinned(workspaceId: string, pinned: boolean) {
      const host = owner(workspaceId);
      const port = host.live.session.workspacePins;
      if (!port)
        throw Error(`${host.label} needs a newer daemon (workspacePinning)`);
      await port.setPinned(workspaceId, pinned);
    },
  };
  const actions = (host: Host) => host.live.session.management;
  const startupSchedules = () => first().live.session.schedules;
  const startup = {
    status: combineStores({
      sources: hosts,
      store: (host: Host) => host.live.session.status,
      merge: (values): HostConnectionState =>
        values[0]?.value ?? { status: "idle" },
    }),
    usage: list()[0]?.live.session.usage
      ? {
          ...combineStores({
            sources: hosts,
            store: (host: Host) => host.live.session.usage ?? NO_USAGE,
            merge: (values): UsageSnapshot =>
              values[0]?.value ?? NO_USAGE_SNAPSHOT,
          }),
          refresh: (options?: { force?: boolean }) =>
            first().live.session.usage?.refresh(options) ?? Promise.resolve(),
          close() {},
        }
      : undefined,
    schedules: {
      list: () => startupSchedules().list(),
      inspect: (id) => startupSchedules().inspect(id),
      logs: (id) => startupSchedules().logs(id),
      pause: (id) => startupSchedules().pause(id),
      resume: (id) => startupSchedules().resume(id),
      runOnce: (id) => startupSchedules().runOnce(id),
      remove: (id) => startupSchedules().remove(id),
      create: (input) => startupSchedules().create(input),
    } satisfies SchedulePort,
  };

  const management: WorkspaceActions = {
    async baseBranches(project) {
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
    renameWorkspace: async (workspace, title) =>
      actions(owner(workspace.id)).renameWorkspace(workspace, title),
    renameTab: async (tab, title) =>
      actions(tabOwner(tab)).renameTab(tab, title),
    closeTab: async (tab) => actions(tabOwner(tab)).closeTab(tab),
    directories: async (query) => actions(current()).directories(query),
    addProject: async (cwd) => actions(current()).addProject(cwd),
    async removeProject(project, workspaces) {
      const owners = projectOwners(project.projectId);
      const offline = owners.filter(({ host }) => !online(host));
      if (offline.length === owners.length && offline[0])
        reachable(offline[0].host);
      for (const { host, project: own } of owners)
        if (online(host))
          await actions(host).removeProject(
            own,
            workspaces.filter((workspace) => find(workspace.id) === host),
          );
      if (offline.length)
        throw Error(
          `${offline.map(({ host }) => host.label).join(", ")} is offline`,
        );
    },
    archiveWorkspace: async (workspace) =>
      actions(owner(workspace.id)).archiveWorkspace(workspace),
  };

  const catalog = {
    providers: async () => current().live.session.agentsPort.providers(),
    models: async (provider: string) =>
      current().live.session.agentsPort.models(provider),
    modes: async (provider: string) =>
      current().live.session.agentsPort.modes(provider),
    onProvidersChange: (listener: () => void) =>
      (
        (focused ? find(focused) : null) ?? first()
      ).live.session.agentsPort.onProvidersChange(listener),
    async create(input: Parameters<AgentsPort["create"]>[0]) {
      const host = current();
      return owned(host, await host.live.session.agentsPort.create(input));
    },
  };
  const stream = (id: string) => known(id).live.session.terminalStream;
  const terminalStream: TerminalStreamPort = {
    observe: (id, receive, onError, onExit) =>
      stream(id).observe(id, receive, onError, onExit),
    write: (id, data) => stream(id).write(id, data),
    resize: (id, cols, rows) => stream(id).resize(id, cols, rows),
  };
  function subagentsOf(parentAgentId: string) {
    const store = known(parentAgentId).live.session.subagents;
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

  /** The session each timeline store was opened on. */
  const servedBy = new WeakMap<TimelineStore, HostSession>();
  const registry = createTimelineRegistry((agent) => {
    const session = known(agent.id).live.session;
    const store = session.openTimeline(agent);
    servedBy.set(store, session);
    return store;
  });
  /** A host whose connection was replaced lists its agents again: their stores move to it. */
  function rebind() {
    registry.rebind((agent, store) => {
      const host = find(agent.id);
      return host !== null && servedBy.get(store) !== host.live.session;
    });
  }
  let stopRebind: (() => void) | null = null;
  const timelines: TimelineRegistry = {
    ...registry,
    acquire(agent) {
      stopRebind ??= agents.subscribe(rebind);
      return registry.acquire(agent);
    },
    close() {
      stopRebind?.();
      stopRebind = null;
      registry.close();
    },
  };

  return {
    agents,
    directory,
    labels,
    management,
    catalog,
    terminalStream,
    subagents,
    terminals: {
      ref: (id: string) => known(id).live.session.terminals.ref(id),
    } satisfies HostSession["terminals"],
    timelines,
    completions: {
      commands: async (source) =>
        current().live.session.completions.commands(source),
      files: async (cwd, query) =>
        current().live.session.completions.files(cwd, query),
    } satisfies CompletionPort,
    directories: {
      list: async (path) => current().live.session.directories.list(path),
    } satisfies DirectoryPort,
    get history() {
      return historyHosts().length ? history : null;
    },
    workspaceRead,
    workspacePins,
    clearAttention: async (agentId: string) =>
      owner(agentId).live.session.clearAttention(agentId),
    /** The agent's host is reached over the network rather than this machine's Paseo home. */
    isRemoteAgent(agentId: string) {
      const host = find(agentId);
      return host !== null && !LOCAL_HOST.test(host.id);
    },
    async refresh() {
      await Promise.all(
        list()
          .filter(online)
          .map((host) => host.live.session.refresh()),
      );
    },
    /** Every connected host rediscovers its providers. */
    async refreshProviders() {
      await Promise.all(
        list()
          .filter(online)
          .map((host) => host.live.session.refreshProviders()),
      );
    },
    /** The workspace the window shows; host-less requests go to its host. */
    focus(workspaceId: string | null) {
      focused = workspaceId;
    },
    /** The startup host's status, usage and schedules, following it across reconnects. */
    startup,
  };
}
