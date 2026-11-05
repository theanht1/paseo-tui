import type { PaseoAgent, PaseoProject } from "@getpaseo/client";
import { createEmitter } from "../state/emitter.js";
import type { AgentsPort, CreateAgentInput } from "../state/ports.js";
import type { ThinkingPreference } from "./agent/thinking-preference.js";
import { agentConfigurationStep } from "./command-center/create-agent.js";
import type { CommandStep } from "./command-center/registry.js";
import { editorTerminal } from "./file-links/editor-terminal.js";
import type { FileLink } from "./file-links/links.js";
import { newTabInput } from "./workspace/tab-template.js";
import type {
  WorkspaceActions,
  WorkspacePlacement,
} from "./workspace/workspace-actions.js";
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
  /** Directory workspaces; Local creation reuses the project's main checkout among them. */
  workspaces: readonly WorkspaceRow[];
  workspace: WorkspaceRow | null;
  tab: WorkspaceTab | null;
  catalog: Pick<AgentsPort, "providers" | "models" | "modes"> | null;
  actions: WorkspaceActions | undefined;
  thinkingPreference?: ThinkingPreference;
  refresh(): Promise<void>;
  /** `input` puts the new tab straight into input mode. */
  opened(result: {
    workspace?: WorkspaceRow;
    tab?: WorkspaceTab;
    input?: boolean;
  }): void;
  closed?(tab: WorkspaceTab): void;
  archived?(workspace: WorkspaceRow): void;
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
  };
  function opened(workspace: WorkspaceRow, agent: PaseoAgent | null) {
    context().opened({
      workspace,
      ...(agent
        ? { tab: { kind: "agent", key: `agent:${agent.id}`, agent } }
        : {}),
    });
  }
  function configure(
    project: PaseoProject,
    placement: WorkspacePlacement,
  ): CommandStep {
    const main = context().workspaces.find(
      (workspace) =>
        workspace.projectId === project.projectId &&
        workspace.workspaceDirectory === project.projectRootPath,
    );
    return agentConfigurationStep(catalog, project.projectRootPath, (input) =>
      run(
        placement.kind === "local" ? "Creating agent…" : "Creating workspace…",
        async () => {
          await context().thinkingPreference?.flush();
          if (placement.kind === "local" && main) {
            const agent = await actions().createAgent(main, input);
            await context().refresh();
            opened(main, agent);
            return;
          }
          const result = await actions().createWorkspace(
            project,
            input,
            placement,
          );
          await context().refresh();
          opened(result.workspace, result.agent);
        },
      ),
    );
  }
  function worktreeStep(project: PaseoProject): CommandStep {
    return {
      kind: "choice",
      title: "Base branch",
      items: async () => {
        const { branches, defaultBranch } =
          await actions().baseBranches(project);
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
              configure(project, {
                kind: "worktree",
                baseBranch: branch,
                branchName: name.trim() || null,
              }),
          }),
        }));
      },
    };
  }
  /** Git projects choose Local (main checkout) or a new Worktree; other projects are local only. */
  function workspaceStep(project: PaseoProject): CommandStep {
    if (project.projectKind !== "git")
      return configure(project, { kind: "local" });
    return {
      kind: "choice",
      title: "Workspace",
      items: () => [
        {
          id: "placement:local",
          group: "Workspaces",
          title: "Local",
          subtitle: `Main checkout · ${project.projectRootPath}`,
          run: () => configure(project, { kind: "local" }),
        },
        {
          id: "placement:worktree",
          group: "Workspaces",
          title: "Worktree",
          subtitle: "New git worktree from a base branch",
          run: () => worktreeStep(project),
        },
      ],
    };
  }
  function createWorkspace(project?: PaseoProject) {
    wizard(
      "New workspace",
      project
        ? workspaceStep(project)
        : {
            kind: "choice",
            title: "Project",
            items: () =>
              context().projects.map((project) => ({
                id: `project:${project.projectId}`,
                group: "Workspaces",
                title: project.projectCustomName || project.projectDisplayName,
                subtitle: project.projectRootPath,
                run: () => workspaceStep(project),
              })),
          },
    );
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
  /** Runs vim on the file in a new terminal tab named after it. */
  function openFile(
    workspace: WorkspaceRow,
    link: Pick<FileLink, "path" | "line" | "col">,
  ) {
    run("Opening file…", async () => {
      const terminal = await actions().openFile(
        workspace,
        editorTerminal(link),
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
    if (tab.kind === "subagent") {
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
    createTab,
    createTerminalTab,
    openFile,
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
