import type { PaseoAgent, PaseoProject, PaseoTerminal } from "@getpaseo/client";
import type { ForkAttachment } from "../connection/ports.js";
import { createEmitter } from "../state/emitter.js";
import type { AgentsPort, CreateAgentInput } from "../state/ports.js";
import type { ThinkingPreference } from "./agent/thinking-preference.js";
import {
  agentConfigurationStep,
  type ConfigurationDeps,
} from "./command-center/create-agent.js";
import type { CommandStep } from "./command-center/registry.js";
import { editorTerminal } from "./file-links/editor-terminal.js";
import type { FileLink } from "./file-links/links.js";
import { type HostScope, type HostsPort, hostSubtitle } from "./hosts/hosts.js";
import type { ProjectPlacement } from "./hosts/merge.js";
import { diffToolTab, diffToolTerminal } from "./workspace/diff-tool.js";
import { newTabInput } from "./workspace/tab-template.js";
import type {
  WorkspaceActions,
  WorkspacePlacement,
} from "./workspace/workspace-actions.js";
import {
  editorTab,
  workspaceEditorTerminal,
} from "./workspace/workspace-editor.js";
import {
  tabName,
  type WorkspaceRow,
  type WorkspaceTab,
} from "./workspace/workspaces.js";
export type RenameTarget =
  | { kind: "workspace"; workspace: WorkspaceRow }
  | { kind: "tab"; tab: WorkspaceTab };
export type ManagementOverlay =
  | { kind: "closed" }
  | { kind: "wizard"; title: string; step: CommandStep }
  | { kind: "confirm-close"; tab: WorkspaceTab }
  | { kind: "confirm-archive"; workspace: WorkspaceRow }
  | { kind: "menu"; target: RenameTarget; x: number; y: number };
interface ManagementSnapshot {
  overlay: ManagementOverlay;
  operation:
    | { kind: "idle" }
    | { kind: "running"; message: string }
    | { kind: "error"; message: string };
}
export interface ManagementContext {
  projects: readonly PaseoProject[];
  /** Live agents; the newest in the workspace seeds new tabs when the current tab is not an agent. */
  agents: readonly PaseoAgent[];
  workspaces: readonly WorkspaceRow[];
  workspace: WorkspaceRow | null;
  tab: WorkspaceTab | null;
  catalog: Pick<
    AgentsPort,
    "providers" | "models" | "modes" | "onProvidersChange"
  > | null;
  actions: WorkspaceActions | undefined;
  thinkingPreference?: ThinkingPreference;
  refresh(): Promise<void>;
  /** `input` puts the new tab straight into input mode; `file` is the path an editor tab opened. */
  opened(result: {
    workspace?: WorkspaceRow;
    tab?: WorkspaceTab;
    input?: boolean;
    file?: string;
  }): void;
  closed?(tab: WorkspaceTab): void;
  archived?(workspace: WorkspaceRow): void;
  /** Every host, to add projects and hosts on; absent with a single daemon (tests). */
  hosts?: HostsPort;
  /** Where a (merged) project lives, one entry per host; absent with a single daemon. */
  placements?(projectId: string): readonly ProjectPlacement[];
  /** A short confirmation in the status bar. */
  notify?(text: string): void;
}
/** A first agent already configured, e.g. a fork; `start` runs when the workspace is created. */
export interface AgentSeed {
  provider: string;
  model: string;
  modeId: string | null;
  thinkingOptionId?: string;
  title: string | null;
  start(): Promise<{
    prompt: string | null;
    attachments: readonly ForkAttachment[];
  }>;
}
/** A host to create on: the window's own management (`host` null) or one host's. */
interface Target {
  host: string | null;
  projects(): readonly PaseoProject[] | Promise<readonly PaseoProject[]>;
  actions(): WorkspaceActions;
  catalog: ConfigurationDeps;
  created(workspace: WorkspaceRow, agent: PaseoAgent | null): Promise<void>;
  added(project: PaseoProject): Promise<void>;
}
function projectName(project: PaseoProject) {
  return project.projectCustomName || project.projectDisplayName;
}
export function createManagementController(context: () => ManagementContext) {
  const emitter = createEmitter();
  let snapshot: ManagementSnapshot = {
    overlay: { kind: "closed" },
    operation: { kind: "idle" },
  };
  let pending = Promise.resolve();
  function publish(next: ManagementSnapshot) {
    snapshot = next;
    emitter.notify();
  }
  function close() {
    publish({ ...snapshot, overlay: { kind: "closed" } });
  }
  function wizard(title: string, step: CommandStep) {
    publish({ ...snapshot, overlay: { kind: "wizard", title, step } });
  }
  function actions() {
    const port = context().actions;
    if (!port)
      throw Error(
        "Workspace management is unavailable. Update the Paseo daemon and reconnect.",
      );
    return port;
  }
  function run(message: string, work: () => Promise<void>) {
    if (snapshot.operation.kind === "running") return;
    publish({
      overlay: { kind: "closed" },
      operation: { kind: "running", message },
    });
    pending = Promise.resolve()
      .then(work)
      .then(
        () => publish({ ...snapshot, operation: { kind: "idle" } }),
        (error: unknown) =>
          publish({
            ...snapshot,
            operation: {
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
      );
  }
  const catalog = {
    get thinkingPreference() {
      return context().thinkingPreference;
    },
    providers: () => {
      const port = context().catalog;
      if (!port) throw Error("Provider catalog is unavailable");
      return port.providers();
    },
    models: (provider: string) => {
      const port = context().catalog;
      if (!port) throw Error("Provider catalog is unavailable");
      return port.models(provider);
    },
    modes: (provider: string) => {
      const port = context().catalog;
      if (!port) throw Error("Provider catalog is unavailable");
      return port.modes(provider);
    },
    onProvidersChange: (listener: () => void) =>
      context().catalog?.onProvidersChange(listener) ?? (() => {}),
  };
  function opened(workspace: WorkspaceRow, agent: PaseoAgent | null) {
    context().opened({
      workspace,
      ...(agent
        ? { tab: { kind: "agent", key: `agent:${agent.id}`, agent } }
        : {}),
    });
  }
  /** This window's host. */
  const here: Target = {
    host: null,
    projects: () => context().projects,
    actions,
    catalog,
    async created(workspace, agent) {
      await context().refresh();
      opened(workspace, agent);
    },
    async added() {
      await context().refresh();
    },
  };
  /** One host of several; what is made there joins the merged window. */
  function scoped(scope: HostScope): Target {
    return {
      ...here,
      host: scope.label,
      projects: scope.projects,
      actions: () => scope.actions,
      catalog: {
        get thinkingPreference() {
          return context().thinkingPreference;
        },
        providers: () => scope.catalog.providers(),
        models: (provider: string) => scope.catalog.models(provider),
        modes: (provider: string) => scope.catalog.modes(provider),
        onProvidersChange: (listener: () => void) =>
          scope.catalog.onProvidersChange(listener),
      },
    };
  }
  function connectedHosts(hosts: HostsPort) {
    return hosts.list().filter((host) => host.status === "connected");
  }
  function notify(text: string) {
    context().notify?.(text);
  }
  /** Asks which connected host when there is more than one. */
  function hostStep(
    next: (target: () => Promise<Target>) => CommandStep,
  ): CommandStep {
    const hosts = context().hosts;
    if (!hosts || connectedHosts(hosts).length < 2)
      return next(async () => here);
    return {
      kind: "choice",
      title: "Host",
      items: () =>
        connectedHosts(hosts).map((host) => {
          let target: Promise<Target> | null = null;
          return {
            id: `host:${host.id}`,
            group: "Workspaces",
            title: host.label,
            subtitle: hostSubtitle(host),
            run: () =>
              next(() => {
                target ??= Promise.resolve().then(() =>
                  scoped(hosts.scope(host.id)),
                );
                return target;
              }),
          };
        }),
    };
  }
  /**
   * A merged project's host: straight to Local/Worktree when it lives on one, a Host
   * step when on several; each creates with that host's own project and catalog.
   */
  function placementStep(
    project: PaseoProject,
    seed: AgentSeed | null,
  ): CommandStep | undefined {
    const { hosts, placements } = context();
    const found = placements?.(project.projectId) ?? [];
    if (!hosts || found.length === 0) return workspaceStep(here, project, seed);
    function on(hostId: string, own: PaseoProject) {
      if (!hosts) throw Error("Hosts are unavailable");
      return workspaceStep(scoped(hosts.scope(hostId)), own, seed);
    }
    const only = found.length === 1 ? found[0] : undefined;
    if (only) return on(only.hostId, only.project);
    return {
      kind: "choice",
      title: "Host",
      items: () =>
        found.map(({ hostId, project: own }) => {
          const host = hosts.list().find((option) => option.id === hostId);
          return {
            id: `host:${hostId}`,
            group: "Workspaces" as const,
            title: host?.label ?? hostId,
            subtitle: `${own.projectRootPath} · ${host?.status ?? "offline"}`,
            run: () => on(hostId, own),
          };
        }),
    };
  }
  async function seededInput(
    seed: AgentSeed,
    cwd: string,
  ): Promise<CreateAgentInput> {
    const { prompt, attachments } = await seed.start();
    return {
      provider: seed.provider,
      model: seed.model,
      modeId: seed.modeId,
      ...(seed.thinkingOptionId
        ? { thinkingOptionId: seed.thinkingOptionId }
        : {}),
      cwd,
      title: seed.title,
      prompt,
      attachments,
    };
  }
  /** Creates the workspace, configuring its first agent unless a seed already did. */
  function configure(
    target: Target,
    project: PaseoProject,
    placement: WorkspacePlacement,
    seed: AgentSeed | null,
  ): CommandStep | undefined {
    function create(input: () => Promise<CreateAgentInput>) {
      run(
        target.host
          ? `Creating workspace on ${target.host}…`
          : "Creating workspace…",
        async () => {
          await context().thinkingPreference?.flush();
          const result = await target
            .actions()
            .createWorkspace(project, await input(), placement);
          await target.created(result.workspace, result.agent);
        },
      );
    }
    if (seed) {
      create(() => seededInput(seed, project.projectRootPath));
      return undefined;
    }
    return agentConfigurationStep(
      target.catalog,
      project.projectRootPath,
      (input) => create(async () => input),
      { titlePlaceholder: "Workspace and tab title (optional)" },
    );
  }
  function worktreeStep(
    target: Target,
    project: PaseoProject,
    seed: AgentSeed | null,
  ): CommandStep {
    return {
      kind: "choice",
      title: "Base branch",
      items: async () => {
        const { branches, defaultBranch } = await target
          .actions()
          .baseBranches(project);
        return branches.map((branch) => ({
          id: `branch:${branch}`,
          group: "Workspaces",
          title: branch,
          subtitle: branch === defaultBranch ? "default" : "",
          run: (): CommandStep => ({
            kind: "input",
            title: "Branch name",
            placeholder: "New branch name (optional, Enter to auto-name)",
            submit: (name) =>
              configure(
                target,
                project,
                {
                  kind: "worktree",
                  baseBranch: branch,
                  branchName: name.trim() || null,
                },
                seed,
              ),
          }),
        }));
      },
    };
  }
  /** Git projects choose Local (a new workspace on the main checkout) or a new Worktree; other projects are local only. */
  function workspaceStep(
    target: Target,
    project: PaseoProject,
    seed: AgentSeed | null,
  ): CommandStep | undefined {
    if (project.projectKind !== "git")
      return configure(target, project, { kind: "local" }, seed);
    return {
      kind: "choice",
      title: "Workspace",
      items: () => [
        {
          id: "placement:local",
          group: "Workspaces",
          title: "Local",
          subtitle: `Main checkout · ${project.projectRootPath}`,
          run: () => configure(target, project, { kind: "local" }, seed),
        },
        {
          id: "placement:worktree",
          group: "Workspaces",
          title: "Worktree",
          subtitle: "New git worktree from a base branch",
          run: () => worktreeStep(target, project, seed),
        },
      ],
    };
  }
  function addProjectItem() {
    return {
      id: "add-project",
      group: "Workspaces" as const,
      title: "Add project…",
      subtitle: "Find a directory on the host",
      run: () => hostStep(directoryStep),
    };
  }
  /** Every project (merged across hosts); each continues to its host and placement. */
  function projectStep(seed: AgentSeed | null): CommandStep {
    return {
      kind: "choice",
      title: "Project",
      items: () => [
        ...context().projects.map((project) => ({
          id: `project:${project.projectId}`,
          group: "Workspaces" as const,
          title: projectName(project),
          subtitle: project.projectRootPath,
          run: () => placementStep(project, seed),
        })),
        addProjectItem(),
      ],
    };
  }
  /** New workspace › Project › Host (when on several) › Local/Worktree › first agent. */
  function createWorkspace(
    project?: PaseoProject,
    seed: AgentSeed | null = null,
  ) {
    const title = seed ? "Fork to new workspace" : "New workspace";
    const step = project ? placementStep(project, seed) : projectStep(seed);
    if (step) wizard(title, step);
  }
  function directoryStep(target: () => Promise<Target>): CommandStep {
    return {
      kind: "search",
      title: "Directory",
      placeholder: "Search directories on the host, or type a full path",
      async search(query) {
        const host = await target();
        const paths = await host.actions().directories(query);
        const typed = query.trim();
        const literal =
          /^[~/]/.test(typed) && !paths.includes(typed) ? [typed] : [];
        return [...literal, ...paths].map((path) => ({
          id: `directory:${path}`,
          group: "Workspaces" as const,
          title: path,
          ...(literal.includes(path) ? { subtitle: "Use this path" } : {}),
          run(): undefined {
            run(
              host.host ? `Adding project on ${host.host}…` : "Adding project…",
              async () => {
                const project = await host.actions().addProject(path);
                await host.added(project);
                notify(`Added project ${projectName(project)}`);
              },
            );
          },
        }));
      },
    };
  }
  /** Add project › Host (when several) › Directory. */
  function addProject() {
    wizard("Add project", hostStep(directoryStep));
  }
  function removeStep(project: PaseoProject): CommandStep {
    const workspaces = context().workspaces.filter(
      (workspace) => workspace.projectId === project.projectId,
    );
    const count = workspaces.length;
    return {
      kind: "confirm",
      title: `Remove ${projectName(project)}? Archives its ${count} workspace${count === 1 ? "" : "s"} and deletes their worktrees; the main checkout stays`,
      confirm() {
        run("Removing project…", async () => {
          await actions().removeProject(project, workspaces);
          await context().refresh();
          notify(`Removed project ${projectName(project)}`);
        });
      },
    };
  }
  /** This host's projects; each opens New workspace or Remove. */
  function listProjects() {
    wizard("Projects", {
      kind: "choice",
      title: "Project",
      items: () => [
        ...context().projects.map((project) => {
          const count = context().workspaces.filter(
            (workspace) => workspace.projectId === project.projectId,
          ).length;
          return {
            id: `project:${project.projectId}`,
            group: "Workspaces" as const,
            title: projectName(project),
            subtitle: `${project.projectRootPath} · ${count} workspace${count === 1 ? "" : "s"}`,
            run: (): CommandStep => ({
              kind: "choice",
              title: projectName(project),
              items: () => [
                {
                  id: "project:new-workspace",
                  group: "Workspaces",
                  title: "New workspace…",
                  run: () => placementStep(project, null),
                },
                {
                  id: "project:remove",
                  group: "Workspaces",
                  title: "Remove project…",
                  subtitle: "Archive its workspaces and delete their worktrees",
                  run: () => removeStep(project),
                },
              ],
            }),
          };
        }),
        addProjectItem(),
      ],
    });
  }
  /** Remove project › Project › confirm; with a project, straight to confirm. */
  function removeProject(project?: PaseoProject) {
    wizard(
      "Remove project",
      project
        ? removeStep(project)
        : {
            kind: "choice",
            title: "Project",
            items: () =>
              context().projects.map((candidate) => ({
                id: `project:${candidate.projectId}`,
                group: "Workspaces" as const,
                title: projectName(candidate),
                subtitle: candidate.projectRootPath,
                run: () => removeStep(candidate),
              })),
          },
    );
  }
  /** The New workspace steps for a configured first agent, to continue another flow (Fork). */
  function seededWorkspaceStep(seed: AgentSeed): CommandStep {
    return projectStep(seed);
  }
  function requireHosts() {
    const hosts = context().hosts;
    if (!hosts) throw Error("Hosts are unavailable");
    return hosts;
  }
  function addHostStep(): CommandStep {
    return {
      kind: "input",
      title: "Address",
      placeholder: "host:port, tcp://host:port, or ssh://user@host",
      required: "Address",
      submit: (address): CommandStep => ({
        kind: "input",
        title: "Name",
        placeholder: "A name for this host, e.g. Build",
        required: "Name",
        submit: (name): CommandStep => ({
          kind: "input",
          title: "Password",
          placeholder: "The daemon's PASEO_PASSWORD (Enter for none)",
          secret: true,
          submit(password): undefined {
            // The address may carry `?password=`; say nothing of it.
            run("Connecting to the host…", async () => {
              const host = await requireHosts().add({
                connection: address,
                label: name.trim() || null,
                password: password || null,
              });
              notify(`Added host ${host.label}`);
            });
          },
        }),
      }),
    };
  }
  function addHost() {
    wizard("Add host", addHostStep());
  }
  /** Every host and its status; choosing an offline one reconnects it. */
  function listHosts() {
    const hosts = context().hosts;
    wizard("Hosts", {
      kind: "choice",
      title: "Host",
      items: () => [
        ...(hosts?.list() ?? []).map((host) => ({
          id: `host:${host.id}`,
          group: "Workspaces" as const,
          title: host.label,
          subtitle:
            host.status === "offline"
              ? `${hostSubtitle(host)} · Enter to reconnect`
              : hostSubtitle(host),
          run(): undefined {
            if (host.status === "offline" && hosts)
              run(`Connecting to ${host.label}…`, async () => {
                await hosts.connect(host.id);
                notify(`Connected to ${host.label}`);
              });
          },
        })),
        {
          id: "add-host",
          group: "Workspaces" as const,
          title: "Add host…",
          subtitle: "Connect to another Paseo daemon",
          run: addHostStep,
        },
      ],
    });
  }
  function selectedWorkspace() {
    const workspace = context().workspace;
    if (!workspace)
      publish({
        ...snapshot,
        operation: { kind: "error", message: "Select a workspace first" },
      });
    return workspace;
  }
  function createAgentTab(workspace: WorkspaceRow, input: CreateAgentInput) {
    run("Creating agent…", async () => {
      await context().thinkingPreference?.flush();
      const agent = await actions().createAgent(workspace, input);
      await context().refresh();
      context().opened({
        tab: { kind: "agent", key: `agent:${agent.id}`, agent },
      });
    });
  }
  function createTerminalTab() {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    run("Creating terminal…", async () => {
      const terminal = await actions().createTerminal(workspace);
      await context().refresh();
      context().opened({
        tab: { kind: "terminal", key: `terminal:${terminal.id}`, terminal },
      });
    });
  }
  /** Runs the file editor (default vim) on the file in a new terminal tab named after it. */
  function openFile(
    workspace: WorkspaceRow,
    link: Pick<FileLink, "path" | "line" | "col">,
    command?: string,
  ) {
    run("Opening file…", async () => {
      const terminal = await actions().openFile(
        workspace,
        editorTerminal(link, command),
      );
      await context().refresh();
      context().opened({
        tab: { kind: "terminal", key: `terminal:${terminal.id}`, terminal },
        input: true,
        file: link.path,
      });
    });
  }
  /** Focuses the workspace's open diff-tool tab, or runs the tool in a new one. */
  function openDiffTool(command: string, terminals: readonly PaseoTerminal[]) {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    const existing = diffToolTab(workspace.id, terminals, command);
    if (existing) {
      context().opened({ tab: existing, input: true });
      return;
    }
    run("Opening changes…", async () => {
      const terminal = await actions().openFile(
        workspace,
        diffToolTerminal(command),
      );
      await context().refresh();
      context().opened({
        tab: { kind: "terminal", key: `terminal:${terminal.id}`, terminal },
        input: true,
      });
    });
  }
  /** Focuses the workspace's open editor tab, or runs the editor on the workspace in a new one. */
  function openEditor(command: string, terminals: readonly PaseoTerminal[]) {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    const existing = editorTab(workspace.id, terminals, command);
    if (existing) {
      context().opened({ tab: existing, input: true });
      return;
    }
    run("Opening editor…", async () => {
      const terminal = await actions().openFile(
        workspace,
        workspaceEditorTerminal(command),
      );
      await context().refresh();
      context().opened({
        tab: { kind: "terminal", key: `terminal:${terminal.id}`, terminal },
        input: true,
      });
    });
  }
  /** Copies the current (or newest) agent's config; only asks when nothing can be derived. */
  function createTab() {
    const workspace = selectedWorkspace();
    if (!workspace) return;
    const input = newTabInput(workspace, context().tab, context().agents);
    if (input) {
      createAgentTab(workspace, input);
      return;
    }
    wizard("New tab", {
      kind: "choice",
      title: "Tab type",
      items: () => [
        {
          id: "new-agent-tab",
          group: "Agents",
          title: "New agent",
          run: () =>
            agentConfigurationStep(
              catalog,
              workspace.workspaceDirectory ?? workspace.projectRootPath,
              (input) => createAgentTab(workspace, input),
            ),
        },
        {
          id: "new-terminal-tab",
          group: "Agents",
          title: "New terminal",
          run(): undefined {
            createTerminalTab();
          },
        },
      ],
    });
  }
  function renameWorkspace(workspace: WorkspaceRow) {
    wizard("Rename workspace", {
      kind: "input",
      title: "Name",
      placeholder: "Workspace name",
      initial: workspace.title || workspace.name,
      submit(title): undefined {
        run("Renaming workspace…", async () => {
          await actions().renameWorkspace(workspace, title);
          await context().refresh();
        });
      },
    });
  }
  function renameTab(tab: WorkspaceTab) {
    wizard("Rename tab", {
      kind: "input",
      title: "Name",
      placeholder: "Tab name",
      initial: tabName(tab),
      submit(title): undefined {
        run("Renaming tab…", async () => {
          await actions().renameTab(tab, title);
          await context().refresh();
        });
      },
    });
  }
  function renameCurrentTab() {
    const tab = context().tab;
    if (tab) renameTab(tab);
  }
  function closeTab(tab: WorkspaceTab | null = context().tab) {
    if (!tab || snapshot.operation.kind === "running") return;
    // A subagent tab or an archived session's view-only tab closes client-side only.
    if (
      tab.kind === "subagent" ||
      (tab.kind === "agent" && tab.agent.archivedAt != null)
    ) {
      context().closed?.(tab);
      return;
    }
    publish({ ...snapshot, overlay: { kind: "confirm-close", tab } });
  }
  function archiveWorkspace(workspace: WorkspaceRow) {
    if (snapshot.operation.kind === "running") return;
    publish({ ...snapshot, overlay: { kind: "confirm-archive", workspace } });
  }
  function confirmArchiveWorkspace() {
    if (snapshot.overlay.kind !== "confirm-archive") return;
    const { workspace } = snapshot.overlay;
    run("Archiving workspace…", async () => {
      await actions().archiveWorkspace(workspace);
      context().archived?.(workspace);
      await context().refresh();
    });
  }
  function confirmCloseTab() {
    if (snapshot.overlay.kind !== "confirm-close") return;
    const { tab } = snapshot.overlay;
    run("Closing tab…", async () => {
      await actions().closeTab(tab);
      context().closed?.(tab);
      await context().refresh();
    });
  }
  function menu(target: RenameTarget, x: number, y: number) {
    publish({ ...snapshot, overlay: { kind: "menu", target, x, y } });
  }
  function renameMenu() {
    if (snapshot.overlay.kind !== "menu") return;
    const { target } = snapshot.overlay;
    if (target.kind === "workspace") renameWorkspace(target.workspace);
    else renameTab(target.tab);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    close,
    createWorkspace,
    addProject,
    listProjects,
    removeProject,
    seededWorkspaceStep,
    addHost,
    listHosts,
    createTab,
    createTerminalTab,
    openFile,
    openDiffTool,
    openEditor,
    renameWorkspace,
    renameTab,
    renameCurrentTab,
    closeTab,
    archiveWorkspace,
    confirmArchiveWorkspace,
    confirmCloseTab,
    menu,
    renameMenu,
    settled: () => pending,
  };
}
