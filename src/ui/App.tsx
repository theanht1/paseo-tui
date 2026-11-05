import type { ConnectionState, PaseoAgent, PaseoApi } from "@getpaseo/client";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompletionPort,
  DirectoryPort,
  ProviderSubagent,
  TerminalStreamPort,
} from "../connection/ports.js";
import type { AgentsSnapshot } from "../state/agents-store.js";
import type { AgentsPort } from "../state/ports.js";
import type { ProviderSubagentStore } from "../state/provider-subagents.js";
import type { TimelineRegistry } from "../state/timeline-registry.js";
import { createTimelineStore } from "../state/timeline-store.js";
import { AgentPane } from "./agent/AgentPane.js";
import {
  agentIndicator,
  createAttentionTracker,
  groupIndicator,
} from "./agent/attention.js";
import { Sidebar } from "./agent/Sidebar.js";
import type { ThinkingPreference } from "./agent/thinking-preference.js";
import { CommandCenter } from "./command-center/CommandCenter.js";
import type { CreateDeps } from "./command-center/create-agent.js";
import {
  type CommandRegistry,
  createCommandRegistry,
} from "./command-center/registry.js";
import { builtinSource } from "./command-center/sources.js";
import {
  type ClipboardWriter,
  copyText,
  type SystemClipboard,
} from "./copy/clipboard.js";
import { type FileLinks, FileLinksContext } from "./file-links/context.js";
import {
  type FileLink,
  fileResolver,
  timelineLinks,
} from "./file-links/links.js";
import { createPathVerifier } from "./file-links/verify.js";
import { createKeyRouter, KeyRouterContext } from "./input/key-router.js";
import {
  type Action,
  interrupt as interruptMode,
  type Mode,
  paletteReturnMode,
  parsePrefix,
  type Stroke,
} from "./input/keymap.js";
import { confirmQuit } from "./input/quit-confirmation.js";
import { useKeymap } from "./input/use-keymap.js";
import { PaneFrame } from "./layout/PaneFrame.js";
import { createPaneTimelines } from "./layout/pane-timelines.js";
import { createPendingAgents } from "./layout/pending-agents.js";
import { sidebarWidth as clampSidebarWidth } from "./layout/sidebar-width.js";
import {
  assign,
  clearAgent,
  close,
  computeRects,
  focusDirection,
  focusIndex,
  focusNext,
  initialLayout,
  type PaneNode,
  panes,
  split,
  toggleZoom,
} from "./layout/split-tree.js";
import {
  createManagementController,
  type ManagementContext,
} from "./management-controller.js";
import { ManagementOverlayView } from "./overlays/ManagementOverlayView.js";
import { ShortcutPopup } from "./overlays/ShortcutPopup.js";
import type { Focus } from "./permission/permission-focus.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "./render/theme.js";
import { StatusBar } from "./StatusBar.js";
import { statusLabel } from "./status-hints.js";
import { SubagentPill } from "./subagents/SubagentPill.js";
import { SubagentPopup } from "./subagents/SubagentPopup.js";
import {
  type PaneSubagents,
  type ProviderView,
  paneSubagents,
  popupRows,
  type SubagentPopupRow,
} from "./subagents/subagent-popup.js";
import { createSubagentTimelines } from "./subagents/subagent-timelines.js";
import { providerHeader } from "./subagents/subagents.js";
import { TerminalPane } from "./terminal/TerminalPane.js";
import { toBlocks } from "./timeline/blocks.js";
import {
  type TimelineControls,
  TimelineView,
} from "./timeline/TimelineView.js";
import { type ExternalStore, useStore } from "./use-store.js";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs.js";
import type { WorkspaceActions } from "./workspace/workspace-actions.js";
import type { DirectorySnapshot } from "./workspace/workspace-directory.js";
import {
  createWorkspaceNavigation,
  reconcileWorkspaceLayout,
} from "./workspace/workspace-navigation.js";
import {
  cycleTab,
  projectTree,
  type SubagentTab,
  subagentTab,
  type WorkspaceRow,
  type WorkspaceTab,
  workspaceTabs,
} from "./workspace/workspaces.js";
export interface AppProps {
  label: string;
  connection: ExternalStore<ConnectionState>;
  agents: ExternalStore<AgentsSnapshot>;
  directory: ExternalStore<DirectorySnapshot>;
  terminals?: PaseoApi["terminals"];
  terminalStream?: TerminalStreamPort;
  management?: WorkspaceActions;
  refresh?(): Promise<void>;
  thinkingPreference?: ThinkingPreference;
  timelines: TimelineRegistry;
  prefix?: Stroke;
  catalog?: Pick<AgentsPort, "providers" | "models" | "modes" | "create">;
  commands?: CommandRegistry;
  clearAttention?(agentId: string): Promise<void>;
  /** Slash-command and @file suggestions for the prompt. */
  completions?: CompletionPort;
  /** Daemon-side directory listings; enables file links in timelines. */
  directories?: DirectoryPort;
  /** Ctrl-G: edit the prompt in an external editor while `host` (the renderer) is suspended. */
  editPrompt?(
    text: string,
    host: { suspend(): Promise<void>; resume(): Promise<void> },
  ): Promise<string>;
  /** Defaults to the renderer's OSC 52 writer. */
  clipboard?: ClipboardWriter;
  /** The local clipboard (pbcopy, wl-copy, xclip…); OSC 52 is still sent alongside. */
  systemClipboard?: SystemClipboard;
  /** Provider-owned subagents; absent when the daemon lacks `providerSubagents`. */
  subagents?: ProviderSubagentStore;
  onExit(): void;
}
export function App({
  label,
  connection,
  agents,
  directory,
  terminals,
  terminalStream,
  management,
  thinkingPreference,
  refresh,
  timelines,
  prefix = DEFAULT_PREFIX,
  onExit,
  commands,
  catalog,
  clearAttention = async () => {},
  completions,
  directories,
  editPrompt,
  clipboard,
  systemClipboard,
  subagents,
}: AppProps) {
  const renderer = useRenderer();
  const router = useMemo(() => createKeyRouter(), []);
  const clipboardWriter: ClipboardWriter = clipboard ?? renderer;
  const [notice, setNotice] = useState<{ text: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  function copy(text: string) {
    void copyText(clipboardWriter, systemClipboard ?? null, text).then(
      (message) => {
        if (message) setNotice({ text: message });
      },
    );
  }
  const copyRef = useRef(copy);
  copyRef.current = copy;
  useEffect(() => {
    function selected() {
      const selection = renderer.getSelection();
      if (selection && !selection.isDragging)
        copyRef.current(selection.getSelectedText());
    }
    renderer.on("selection", selected);
    return () => {
      renderer.off("selection", selected);
    };
  }, [renderer]);
  const promptEditor = useMemo(
    () =>
      editPrompt
        ? (text: string) =>
            editPrompt(text, {
              suspend: () => renderer.suspend(),
              resume: () => renderer.resume(),
            })
        : undefined,
    [editPrompt, renderer],
  );
  const registry = useMemo(
    () => commands ?? createCommandRegistry(),
    [commands],
  );
  const returnMode = useRef<Mode>({ kind: "normal", pending: "" });
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const { width, height } = useTerminalDimensions();
  const { groups, error } = useStore(agents);
  const directoryState = useStore(directory);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<
    ReadonlySet<string>
  >(new Set());
  const projects = useMemo(
    () =>
      projectTree(
        directoryState.projects,
        directoryState.workspaces.filter(
          (workspace) => !archivedWorkspaces.has(workspace.id),
        ),
      ),
    [directoryState, archivedWorkspaces],
  );
  const workspaces = useMemo(
    () => projects.flatMap((project) => project.workspaces),
    [projects],
  );
  const navigation = useMemo(() => createWorkspaceNavigation(), []);
  const navigationState = useStore(navigation);
  const cursorWorkspace = navigationState.cursorId;
  const activeWorkspace = navigationState.workspaceId;
  const terminalId =
    navigationState.tab?.kind === "terminal"
      ? navigationState.tab.terminal.id
      : null;
  const terminalHandle = useMemo(
    () => (terminalId && terminals ? terminals.ref(terminalId) : null),
    [terminalId, terminals],
  );
  const [closedTabs, setClosedTabs] = useState<ReadonlySet<string>>(new Set());
  const flat = useMemo(
    () =>
      groups
        .flatMap((g) => g.agents)
        .filter((agent) => !closedTabs.has(`agent:${agent.id}`)),
    [groups, closedTabs],
  );
  const visibleTerminals = useMemo(
    () =>
      directoryState.terminals.filter(
        (terminal) => !closedTabs.has(`terminal:${terminal.id}`),
      ),
    [directoryState.terminals, closedTabs],
  );
  const [layout, setLayout] = useState(initialLayout);
  const [providerViews, setProviderViews] = useState<
    ReadonlyMap<string, ProviderView>
  >(new Map());
  /** Provider subagent chats opened as tabs; client-side, closing archives nothing. */
  const [subagentTabs, setSubagentTabs] = useState<readonly SubagentTab[]>([]);
  const [focus, setFocus] = useState<Focus>({ pane: "list" }),
    [mode, setMode] = useState<Mode>({ kind: "normal", pending: "" });
  const [promptEdit, setPromptEdit] = useState(0);
  const [help, setHelp] = useState(false),
    [sidebarVisible, setSidebarVisible] = useState(true),
    [numbers, setNumbers] = useState(false);
  const [searchStatuses, setSearchStatuses] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const controls = useRef(new Map<string, TimelineControls>());
  const paneTimelines = useMemo(
    () => createPaneTimelines(timelines),
    [timelines],
  );
  useEffect(() => () => paneTimelines.close(), [paneTimelines]);
  const stores = useStore(paneTimelines);
  const pending = useMemo(() => createPendingAgents(), []);
  const [createError, setCreateError] = useState<{ message: string } | null>(
    null,
  );
  useEffect(() => {
    if (!createError) return;
    const timer = setTimeout(() => setCreateError(null), 5000);
    return () => clearTimeout(timer);
  }, [createError]);
  const verifier = useMemo(
    () => (directories ? createPathVerifier(directories) : null),
    [directories],
  );
  /** Editor terminal tabs; when one exits, input leaves with it. */
  const editorTabs = useRef(new Set<string>());
  const quitDeadline = useRef<number | null>(null);
  const [quitNotice, setQuitNotice] = useState<number | null>(null);
  const [requestedWidth, setRequestedWidth] = useState<number | undefined>();
  useEffect(() => {
    if (quitNotice === null) return;
    const timer = setTimeout(
      () => {
        quitDeadline.current = null;
        setQuitNotice(null);
      },
      Math.max(0, quitNotice - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [quitNotice]);
  function interrupt() {
    const result = confirmQuit(quitDeadline.current, Date.now());
    if (result.quit) onExit();
    else {
      quitDeadline.current = result.deadline;
      setQuitNotice(result.deadline);
    }
  }
  const all = panes(layout);
  useEffect(() => {
    pending.prune(panes(layout), flat, Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Timers can fire a little before Date.now() reaches the expiry; sweep again until none is fresh.
    function sweep() {
      const now = Date.now();
      setLayout((previous) => pending.clearMissing(previous, flat, now));
      const wait = pending.untilExpiry(now);
      if (wait !== null) timer = setTimeout(sweep, wait);
    }
    sweep();
    return () => clearTimeout(timer);
  }, [pending, flat, layout]);
  useEffect(() => {
    paneTimelines.sync(panes(layout), flat);
  }, [paneTimelines, layout, flat]);
  useEffect(() => {
    if (focus.pane !== "prompt") setMode({ kind: "normal", pending: "" });
  }, [focus]);
  useEffect(() => {
    if (!numbers) return;
    const timer = setTimeout(() => setNumbers(false), 1000);
    return () => clearTimeout(timer);
  }, [numbers]);
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === cursorWorkspace) ??
    workspaces[0] ??
    null;
  const activeWorkspaceId =
    workspaces.find((workspace) => workspace.id === activeWorkspace)?.id ??
    workspaces[0]?.id ??
    null;
  const tabs = workspaceTabs(
    activeWorkspaceId,
    flat,
    visibleTerminals,
    subagentTabs,
  );
  const current = all.find((p) => p.id === layout.focusedId);
  useEffect(() => {
    const assigned = flat.find(
      (agent) => agent.id === current?.agentId && agent.archivedAt == null,
    );
    if (
      assigned &&
      workspaces.some((workspace) => workspace.id === assigned.workspaceId) &&
      navigation.getSnapshot().tab?.kind === "agent" &&
      navigation.getSnapshot().tab?.key !== `agent:${assigned.id}`
    )
      navigation.selectTab({
        kind: "agent",
        key: `agent:${assigned.id}`,
        agent: assigned,
      });
    const before = navigation.getSnapshot().tab;
    const next = navigation.reconcile(
      workspaces,
      flat,
      visibleTerminals,
      subagentTabs,
    );
    if (
      before &&
      next.tab?.key !== before.key &&
      editorTabs.current.delete(before.key)
    ) {
      setMode({ kind: "normal", pending: "" });
      setFocus({ pane: "timeline" });
    }
    setLayout((previous) =>
      reconcileWorkspaceLayout(previous, {
        agents: flat,
        tab: next.tab,
        pendingAgentIds: new Set(pending.ids()),
        isWorkspaceRemoved: navigation.isWorkspaceRemoved,
      }),
    );
  }, [
    navigation,
    pending,
    workspaces,
    flat,
    visibleTerminals,
    subagentTabs,
    current?.agentId,
  ]);
  const timeline = current
    ? (stores.get(`${current.id}:${current.agentId}`) ?? null)
    : null;
  const clearAttentionRef = useRef(clearAttention);
  clearAttentionRef.current = clearAttention;
  const attention = useMemo(
    () => createAttentionTracker((id) => clearAttentionRef.current(id)),
    [],
  );
  const acknowledged = useStore(attention);
  const viewedAgent =
    terminalId || focus.pane === "list"
      ? undefined
      : flat.find((agent) => agent.id === current?.agentId);
  useEffect(() => {
    if (viewedAgent) attention.view(viewedAgent);
  }, [attention, viewedAgent]);
  function clearProviderView(paneId: string) {
    setProviderViews((previous) => {
      if (!previous.has(paneId)) return previous;
      const next = new Map(previous);
      next.delete(paneId);
      return next;
    });
  }
  function open(agent: PaseoAgent) {
    clearProviderView(layout.focusedId);
    navigation.selectTab({ kind: "agent", key: `agent:${agent.id}`, agent });
    setLayout((l) => assign(l, agent.id));
    setFocus({
      pane:
        mode.kind === "palette" && returnMode.current.kind === "insert"
          ? "prompt"
          : "timeline",
    });
    if (current?.agentId === agent.id) {
      timelines.reopen(agent.id);
      const request = timeline?.getSnapshot().pendingPermissions[0];
      if (request) setFocus({ pane: "permission", requestId: request.id });
    }
  }
  /** The tab a pane shows: its provider subagent's while one is open, else its agent's. */
  function paneTabKey(pane: PaneNode | undefined): string | null {
    if (!pane?.agentId) return null;
    const view = providerViews.get(pane.id);
    return view && view.parentAgentId === pane.agentId
      ? `subagent:${view.parentAgentId}:${view.subagentId}`
      : `agent:${pane.agentId}`;
  }
  const tabKey = terminalId ? `terminal:${terminalId}` : paneTabKey(current);
  function openTab(tab: WorkspaceTab) {
    if (tab.kind === "agent") open(tab.agent);
    else if (tab.kind === "subagent") {
      const { parentAgentId, id } = tab.descriptor;
      navigation.selectTab(tab);
      setLayout((l) => assign(l, parentAgentId));
      setProviderViews((previous) =>
        new Map(previous).set(layout.focusedId, {
          parentAgentId,
          subagentId: id,
        }),
      );
      setFocus({ pane: "timeline" });
    } else {
      navigation.selectTab(tab);
      setFocus({ pane: "timeline" });
    }
  }
  function openWorkspace(workspace: WorkspaceRow) {
    const tab = navigation.selectWorkspace(workspace, flat, visibleTerminals);
    if (tab) openTab(tab);
    else
      setLayout((l) => (current?.agentId ? clearAgent(l, current.agentId) : l));
  }
  const sidebarWidth = sidebarVisible
    ? clampSidebarWidth(width, requestedWidth)
    : 0;
  const area = {
    x: 0,
    y: 0,
    width: Math.max(0, width - sidebarWidth),
    height: Math.max(0, height - 1 - (error || directoryState.error ? 1 : 0)),
  };
  const rects = computeRects(layout, area);
  const tabIndicators = new Map(
    flat.map((agent) => [
      `agent:${agent.id}`,
      agentIndicator(agent, acknowledged),
    ]),
  );
  const descriptors = useStore(subagents ?? NO_SUBAGENTS);
  const [subagentPopup, setSubagentPopup] = useState<string | null>(null);
  /** The provider subagent a pane shows instead of its agent, while still valid. */
  function providerView(pane: PaneNode): ProviderSubagent | null {
    const view = providerViews.get(pane.id);
    if (!view || view.parentAgentId !== pane.agentId) return null;
    return (
      descriptors.find(
        (descriptor) =>
          descriptor.parentAgentId === view.parentAgentId &&
          descriptor.id === view.subagentId,
      ) ?? null
    );
  }
  function subagentsFor(pane: PaneNode): PaneSubagents | null {
    const descriptor = providerView(pane);
    return paneSubagents(
      flat.find((agent) => agent.id === pane.agentId),
      descriptor
        ? { parentAgentId: descriptor.parentAgentId, subagentId: descriptor.id }
        : null,
      flat,
      descriptors,
    );
  }
  const subagentTimelines = useMemo(
    () =>
      subagents
        ? createSubagentTimelines((parentAgentId, subagentId) =>
            createTimelineStore(
              subagents.timelinePort(parentAgentId, subagentId),
            ),
          )
        : null,
    [subagents],
  );
  useEffect(() => {
    subagentTimelines?.retain(providerViews.values());
  }, [subagentTimelines, providerViews]);
  useEffect(() => () => subagentTimelines?.close(), [subagentTimelines]);
  useEffect(() => {
    if (!subagents) return;
    for (const pane of panes(layout))
      if (pane.agentId) subagents.track(pane.agentId);
  }, [subagents, layout]);
  function openSubagents(index: number, paneId: string) {
    if (paneId !== layout.focusedId) setLayout((l) => focusIndex(l, index));
    setHelp(false);
    setSubagentPopup(paneId);
  }
  function chooseSubagent(paneId: string, row: SubagentPopupRow) {
    setSubagentPopup(null);
    const pane = all.find((candidate) => candidate.id === paneId);
    const view = pane ? subagentsFor(pane) : null;
    if (!view) return;
    function showAgent(agent: PaseoAgent | undefined) {
      clearProviderView(paneId);
      if (!agent) return;
      if (agent.id !== pane?.agentId) open(agent);
      else
        navigation.selectTab({
          kind: "agent",
          key: `agent:${agent.id}`,
          agent,
        });
    }
    if (row.kind === "parent")
      showAgent(flat.find((agent) => agent.id === row.agentId));
    else if (row.entry.kind === "paseo") showAgent(row.entry.agent);
    else {
      const { descriptor } = row.entry;
      const parent = flat.find((agent) => agent.id === view.parentId);
      const workspaceId = parent?.workspaceId ?? activeWorkspaceId;
      if (!workspaceId) return;
      const tab =
        subagentTabs.find(
          (candidate) =>
            candidate.descriptor.parentAgentId === descriptor.parentAgentId &&
            candidate.descriptor.id === descriptor.id,
        ) ?? subagentTab(workspaceId, descriptor);
      setSubagentTabs((previous) =>
        previous.some((candidate) => candidate.key === tab.key)
          ? previous
          : [...previous, tab],
      );
      openTab(tab);
    }
    setFocus({ pane: "timeline" });
  }
  /** A pane's strip lists the tabs of its agent's workspace (the active one when empty). */
  function paneTabs(agent: PaseoAgent | undefined) {
    return agent?.workspaceId && agent.workspaceId !== activeWorkspaceId
      ? workspaceTabs(agent.workspaceId, flat, visibleTerminals, subagentTabs)
      : tabs;
  }
  const managementInputs: ManagementContext = {
    projects: directoryState.projects,
    agents: flat,
    workspaces,
    workspace:
      workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
      null,
    tab: tabs.find((tab) => tab.key === tabKey) ?? null,
    catalog: catalog ?? null,
    thinkingPreference,
    actions: management,
    refresh: async () => {
      await refresh?.();
    },
    archived(workspace) {
      setArchivedWorkspaces((previous) => new Set([...previous, workspace.id]));
    },
    closed(tab) {
      if (tab.kind === "subagent") {
        setSubagentTabs((previous) =>
          previous.filter((candidate) => candidate.key !== tab.key),
        );
        const parent = flat.find(
          (agent) => agent.id === tab.descriptor.parentAgentId,
        );
        if (tabKey === tab.key && parent) open(parent);
        setMode({ kind: "normal", pending: "" });
        return;
      }
      setClosedTabs((previous) => new Set([...previous, tab.key]));
      setMode({ kind: "normal", pending: "" });
      setFocus({ pane: "timeline" });
    },
    opened(result) {
      if (result.tab?.kind === "terminal" && result.input) {
        editorTabs.current.add(result.tab.key);
        navigation.selectTab(result.tab, tabKey ?? undefined);
        setFocus({ pane: "prompt" });
        setMode({ kind: "insert" });
      } else if (result.tab) {
        if (result.tab.kind === "agent")
          pending.add(result.tab.agent.id, Date.now());
        openTab(result.tab);
        if (result.tab.kind === "agent") {
          setFocus({ pane: "prompt" });
          setMode({ kind: "insert" });
        }
      } else if (result.workspace) openWorkspace(result.workspace);
    },
  };
  const managementContext = useRef(managementInputs);
  managementContext.current = managementInputs;
  const manager = useMemo(
    () => createManagementController(() => managementContext.current),
    [],
  );
  const managementState = useStore(manager);
  function openFile(agentId: string, link: FileLink) {
    const owner = flat.find((agent) => agent.id === agentId);
    const workspace =
      workspaces.find((workspace) => workspace.id === owner?.workspaceId) ??
      workspaces.find((workspace) => workspace.id === activeWorkspaceId);
    if (workspace) manager.openFile(workspace, link);
  }
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  const fileLinks = useMemo<FileLinks | null>(
    () =>
      verifier
        ? {
            verifier,
            open: (agentId, link) => openFileRef.current(agentId, link),
            notify: (text) => setNotice({ text }),
          }
        : null,
    [verifier],
  );
  function act(action: Action) {
    switch (action.type) {
      case "workspace.create":
        manager.createWorkspace();
        break;
      case "workspace.rename":
        if (selectedWorkspace) manager.renameWorkspace(selectedWorkspace);
        break;
      case "tab.create":
        setHelp(false);
        setMode({ kind: "normal", pending: "" });
        manager.createTab();
        break;
      case "tab.close":
        manager.closeTab();
        break;
      case "tab.createTerminal":
        setHelp(false);
        manager.createTerminalTab();
        break;
      case "tab.rename":
        manager.renameCurrentTab();
        break;
      case "palette.open":
        manager.close();
        setHelp(false);
        if (mode.kind !== "palette") {
          returnMode.current = paletteReturnMode(mode);
          setMode({ kind: "palette" });
        }
        break;
      case "palette.close":
        if (returnMode.current.kind === "insert")
          setFocus({ pane: "timeline" });
        returnMode.current = { kind: "normal", pending: "" };
        setMode({ kind: "normal", pending: "" });
        break;
      case "copy.start":
        if (terminalId || !timeline) setMode({ kind: "normal", pending: "" });
        else {
          if (mode.kind === "palette") returnMode.current = { kind: "copy" };
          controls.current.get(layout.focusedId)?.act(action);
        }
        break;
      case "prompt.edit":
        if (terminalId || !timeline || !promptEditor) break;
        returnMode.current = { kind: "insert" };
        if (mode.kind !== "palette") setMode({ kind: "insert" });
        setFocus({ pane: "prompt" });
        setPromptEdit((count) => count + 1);
        break;
      case "copy.exit":
      case "hint.cancel":
        setMode({ kind: "normal", pending: "" });
        break;
      case "hint.start":
        if (terminalId || !timeline) setMode({ kind: "normal", pending: "" });
        else controls.current.get(layout.focusedId)?.act(action);
        break;
      case "quit":
        interrupt();
        break;
      case "tab.cycle": {
        const tab = cycleTab(tabs, tabKey, action.delta);
        if (tab) openTab(tab);
        break;
      }
      case "help":
        setHelp((v) => !v);
        break;
      case "sidebar.toggle":
        setSidebarVisible((v) => !v);
        setFocus({ pane: "timeline" });
        break;
      case "focus.toggleSidebar":
        setSidebarVisible(true);
        setFocus(
          focus.pane === "list" ? { pane: "timeline" } : { pane: "list" },
        );
        break;
      case "insert":
        if (timeline || terminalId) setFocus({ pane: "prompt" });
        break;
      case "normal":
        setFocus({ pane: "timeline" });
        break;
      case "list.move":
        navigation.moveCursor(workspaces, action.delta);
        break;
      case "list.edge": {
        const next = action.edge === "top" ? workspaces[0] : workspaces.at(-1);
        if (next) navigation.cursor(next.id);
        break;
      }
      case "list.open":
        if (selectedWorkspace) openWorkspace(selectedWorkspace);
        break;
      case "pane.split":
        setLayout((l) => split(l, action.direction));
        setFocus({ pane: "timeline" });
        break;
      case "pane.close":
        setLayout(close);
        setFocus({ pane: "timeline" });
        break;
      case "pane.next":
        setLayout(focusNext);
        setFocus({ pane: "timeline" });
        break;
      case "pane.focus":
        setLayout((l) => focusDirection(l, action.direction, rects));
        setFocus({ pane: "timeline" });
        break;
      case "pane.select":
        setLayout((l) => focusIndex(l, action.index));
        setNumbers(false);
        setFocus({ pane: "timeline" });
        break;
      case "pane.zoom":
        setLayout(toggleZoom);
        break;
      case "subagents.open":
        if (current && subagentsFor(current)) openSubagents(0, current.id);
        break;
      case "pane.numbers":
        setNumbers(true);
        break;
      default:
        controls.current.get(layout.focusedId)?.act(action);
    }
  }
  const createAgent: CreateDeps | undefined = catalog
    ? {
        thinkingPreference,
        providers: () => catalog.providers(),
        models: (provider) => catalog.models(provider),
        modes: (provider) => catalog.modes(provider),
        create: (input) => catalog.create(input),
        workspaces: workspaces.map((workspace) => ({
          key: workspace.id,
          cwd: workspace.workspaceDirectory ?? workspace.projectRootPath,
          label: workspace.title || workspace.name,
        })),
        defaultCwd:
          workspaces.find((workspace) => workspace.id === activeWorkspaceId)
            ?.workspaceDirectory ??
          flat.find((agent) => agent.id === current?.agentId)?.cwd ??
          null,
        opened(agent) {
          pending.add(agent.id, Date.now());
          open(agent);
        },
        failed(message) {
          setCreateError({ message });
        },
      }
    : undefined;
  const focusedAgent = terminalId
    ? undefined
    : flat.find((a) => a.id === current?.agentId);
  const chatFiles =
    verifier && focusedAgent && timeline
      ? {
          list: () =>
            fileResolver(
              timelineLinks(
                toBlocks(timeline.getSnapshot().rows),
                focusedAgent.cwd,
              ),
              focusedAgent.cwd,
              (path) => verifier.status(path) === "file",
            ).files(),
          open: (link: FileLink) => openFile(focusedAgent.id, link),
        }
      : undefined;
  const sourceContext = useRef({
    files: chatFiles,
    createAgent,
    groups,
    workspaces,
    focusedAgent: terminalId
      ? undefined
      : flat.find((a) => a.id === current?.agentId),
    focusedStore: terminalId ? null : timeline,
    models: catalog?.models,
    prefixLabel: prefixLabel(prefix),
    open,
    changeLayout: setLayout,
    workspace(workspace: WorkspaceRow) {
      setSidebarVisible(true);
      openWorkspace(workspace);
    },
    act,
  });
  sourceContext.current = {
    ...sourceContext.current,
    files: chatFiles,
    createAgent,
    groups,
    workspaces,
    focusedAgent: terminalId
      ? undefined
      : flat.find((a) => a.id === current?.agentId),
    focusedStore: terminalId ? null : timeline,
    models: catalog?.models,
    prefixLabel: prefixLabel(prefix),
    open,
    workspace(workspace: WorkspaceRow) {
      setSidebarVisible(true);
      openWorkspace(workspace);
    },
    act,
  };
  useEffect(
    () =>
      registry.register({
        id: "builtin",
        items: () => builtinSource(sourceContext.current).items(),
      }),
    [registry],
  );
  const terminalInput =
    terminalId !== null && focus.pane === "prompt" && mode.kind === "insert";
  /** Help or a management overlay holds input; panes stay rendered but inactive. */
  const blocked = help || managementState.overlay.kind !== "closed";
  const overlayOpen = blocked || mode.kind === "palette";
  useKeyboard((event) => {
    if (terminalInput) {
      if (event.ctrl && event.name === "]") {
        event.preventDefault();
        event.stopPropagation();
        setMode({ kind: "normal", pending: "" });
        setFocus({ pane: "timeline" });
      }
      return;
    }
    if (router.route(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      managementState.overlay.kind === "confirm-close" ||
      managementState.overlay.kind === "confirm-archive"
    )
      return;
    if (event.ctrl && event.name === "n") {
      event.preventDefault();
      event.stopPropagation();
      act({ type: "tab.create" });
      return;
    }
    if (event.ctrl && event.name === "k") {
      event.preventDefault();
      event.stopPropagation();
      act({ type: "palette.open" });
      return;
    }
    if (event.ctrl && event.name === "c") {
      event.preventDefault();
      event.stopPropagation();
      if (managementState.overlay.kind === "wizard") {
        manager.close();
        setMode({ kind: "normal", pending: "" });
        return;
      }
      const result = interruptMode(mode);
      setMode(result.mode);
      if (result.action) act(result.action);
      return;
    }
  });
  useKeymap(
    numbers ? { kind: "prefix" } : mode,
    focus.pane === "list" ? "sidebar" : "pane",
    setMode,
    act,
    !terminalInput &&
      !help &&
      subagentPopup === null &&
      managementState.overlay.kind === "closed" &&
      mode.kind !== "palette" &&
      focus.pane !== "permission",
    prefix,
  );
  return (
    <FileLinksContext value={fileLinks}>
      <KeyRouterContext value={router}>
        <box
          flexDirection="column"
          width={width}
          height={height}
          backgroundColor={theme.fg ? undefined : backgroundProp(theme.codeBg)}
        >
          <box flexDirection="row" flexGrow={1} minHeight={0}>
            {sidebarVisible ? (
              <Sidebar
                width={sidebarWidth}
                focused={focus.pane === "list" && !overlayOpen}
                onResize={setRequestedWidth}
                projects={projects}
                indicators={
                  new Map(
                    workspaces.map((workspace) => [
                      workspace.id,
                      groupIndicator(
                        flat.filter(
                          (agent) =>
                            agent.workspaceId === workspace.id &&
                            agent.archivedAt == null,
                        ),
                        acknowledged,
                      ),
                    ]),
                  )
                }
                selectedId={selectedWorkspace?.id ?? null}
                openId={activeWorkspaceId}
                onSelect={openWorkspace}
                onCreate={(project) => manager.createWorkspace(project)}
                onContext={(workspace, x, y) =>
                  manager.menu({ kind: "workspace", workspace }, x, y)
                }
              />
            ) : null}
            <box width={area.width} height={area.height} flexDirection="column">
              {terminalId ? (
                <WorkspaceTabs
                  id="pane-tabs:terminal"
                  tabs={tabs}
                  indicators={tabIndicators}
                  selected={tabKey}
                  onSelect={openTab}
                  onClose={(tab) => manager.closeTab(tab)}
                  onCreate={() => act({ type: "tab.create" })}
                  onContext={(tab, x, y) =>
                    manager.menu({ kind: "tab", tab }, x, y)
                  }
                />
              ) : null}
              {terminalHandle && terminalStream ? (
                <TerminalPane
                  key={terminalHandle.id}
                  terminal={terminalHandle}
                  stream={terminalStream}
                  paneFocused={focus.pane !== "list" && !overlayOpen}
                  onFocus={() => {
                    if (focus.pane === "list") setFocus({ pane: "timeline" });
                  }}
                  focused={
                    !overlayOpen &&
                    focus.pane === "prompt" &&
                    mode.kind === "insert"
                  }
                />
              ) : null}
              {terminalId
                ? null
                : all.map((pane, index) => {
                    const rect =
                      layout.zoomedId === pane.id ? area : rects.get(pane.id);
                    if (!rect) return null;
                    const agent = flat.find((a) => a.id === pane.agentId);
                    const store = stores.get(`${pane.id}:${pane.agentId}`);
                    const focusedPane = pane.id === layout.focusedId;
                    const provider = providerView(pane);
                    const paneView = subagentsFor(pane);
                    const paneActive =
                      focusedPane && focus.pane !== "list" && !overlayOpen;
                    function focusPane() {
                      if (!focusedPane) setLayout((l) => focusIndex(l, index));
                    }
                    return (
                      <PaneFrame
                        key={pane.id}
                        paneId={pane.id}
                        rect={rect}
                        visible={
                          !layout.zoomedId || layout.zoomedId === pane.id
                        }
                        focusedPane={focusedPane}
                        active={paneActive}
                        number={numbers ? index : null}
                        tabs={paneTabs(agent)}
                        indicators={tabIndicators}
                        selectedTab={paneTabKey(pane)}
                        onMouseDown={() => {
                          if (!focusedPane) {
                            focusPane();
                            setFocus({ pane: "timeline" });
                          } else if (focus.pane === "list")
                            setFocus({ pane: "timeline" });
                        }}
                        onSelectTab={(tab) => {
                          focusPane();
                          openTab(tab);
                        }}
                        onCloseTab={(tab) => manager.closeTab(tab)}
                        onCreateTab={() => {
                          focusPane();
                          act({ type: "tab.create" });
                        }}
                        onTabContext={(tab, x, y) =>
                          manager.menu({ kind: "tab", tab }, x, y)
                        }
                      >
                        {provider && subagentTimelines ? (
                          <box
                            flexDirection="column"
                            flexGrow={1}
                            minHeight={0}
                          >
                            <TimelineView
                              key={`subagent:${provider.id}`}
                              store={subagentTimelines.get(provider)}
                              agent={providerHeader(provider, agent?.cwd ?? "")}
                              paneFocused={paneActive}
                              focused={
                                paneActive &&
                                focus.pane === "timeline" &&
                                mode.kind === "normal"
                              }
                              controls={(value) => {
                                if (value) controls.current.set(pane.id, value);
                                else controls.current.delete(pane.id);
                              }}
                              copying={paneActive && mode.kind === "copy"}
                              hinting={paneActive && mode.kind === "hint"}
                              onHintDone={() =>
                                setMode({ kind: "normal", pending: "" })
                              }
                              onCopy={(effect) => {
                                setMode({ kind: "normal", pending: "" });
                                if (effect.kind === "yank")
                                  copyRef.current(effect.text);
                              }}
                              onSearchStatus={(status) =>
                                setSearchStatuses((previous) =>
                                  previous.get(pane.id) === status
                                    ? previous
                                    : new Map(previous).set(pane.id, status),
                                )
                              }
                            />
                            {paneView ? (
                              <SubagentPill
                                view={paneView}
                                onOpen={() => openSubagents(index, pane.id)}
                              />
                            ) : null}
                          </box>
                        ) : agent && store ? (
                          <AgentPane
                            subagents={paneView}
                            onOpenSubagents={() =>
                              openSubagents(index, pane.id)
                            }
                            key={`${agent.id}`}
                            store={store}
                            agent={agent}
                            focused={
                              focusedPane &&
                              focus.pane !== "list" &&
                              !blocked &&
                              (mode.kind !== "palette" ||
                                returnMode.current.kind === "insert")
                            }
                            focus={focus}
                            mode={
                              mode.kind === "palette"
                                ? returnMode.current
                                : mode
                            }
                            setFocus={setFocus}
                            setMode={setMode}
                            height={rect.height - 3}
                            prefix={prefix}
                            controls={(value) => {
                              if (value) controls.current.set(pane.id, value);
                              else controls.current.delete(pane.id);
                            }}
                            completions={completions}
                            editPrompt={promptEditor}
                            editRequest={
                              pane.id === layout.focusedId ? promptEdit : 0
                            }
                            onCopy={(effect) => {
                              setMode({ kind: "normal", pending: "" });
                              if (effect.kind === "yank")
                                copyRef.current(effect.text);
                            }}
                            onSearchStatus={(status) =>
                              setSearchStatuses((previous) =>
                                previous.get(pane.id) === status
                                  ? previous
                                  : new Map(previous).set(pane.id, status),
                              )
                            }
                          />
                        ) : (
                          <text fg={foregroundProp(theme.fg)}>
                            {pane.agentId
                              ? "Loading…"
                              : "No agent. Pick one in the sidebar (Tab) or Ctrl-K."}
                          </text>
                        )}
                      </PaneFrame>
                    );
                  })}
            </box>
          </box>
          {subagentPopup !== null ? (
            <SubagentPopup
              rows={popupRows(
                (() => {
                  const pane = all.find((p) => p.id === subagentPopup);
                  return pane ? subagentsFor(pane) : null;
                })(),
              )}
              onSelect={(row) => chooseSubagent(subagentPopup, row)}
              onClose={() => setSubagentPopup(null)}
            />
          ) : null}
          {help ? (
            <ShortcutPopup
              prefix={prefixLabel(prefix)}
              onClose={() => setHelp(false)}
            />
          ) : null}
          <ManagementOverlayView
            overlay={managementState.overlay}
            manager={manager}
            registry={registry}
            completions={completions}
          />
          {mode.kind === "palette" ? (
            <CommandCenter
              registry={registry}
              completions={completions}
              onClose={() => setMode(returnMode.current)}
            />
          ) : null}
          {error || directoryState.error ? (
            <text fg={foregroundProp(theme.error)}>
              {error || directoryState.error}
            </text>
          ) : null}
          <StatusBar
            onHelp={() => {
              manager.close();
              setHelp(true);
            }}
            label={statusLabel({
              label,
              quitPending: quitNotice !== null,
              notice: notice?.text ?? null,
              operation:
                managementState.operation.kind === "idle"
                  ? null
                  : managementState.operation.message,
              createError: createError?.message ?? null,
            })}
            connection={connection}
            timeline={terminalId ? null : timeline}
            mode={mode}
            terminalInput={terminalInput}
            context={focus.pane === "list" ? "sidebar" : "pane"}
            searchStatus={searchStatuses.get(layout.focusedId) ?? ""}
          />
        </box>
      </KeyRouterContext>
    </FileLinksContext>
  );
}
const DEFAULT_PREFIX = parsePrefix("C-b");
const NO_PROVIDER_SUBAGENTS: readonly ProviderSubagent[] = [];
const NO_SUBAGENTS: ExternalStore<readonly ProviderSubagent[]> = {
  subscribe: () => () => {},
  getSnapshot: () => NO_PROVIDER_SUBAGENTS,
};
function prefixLabel(prefix: Stroke) {
  return `Ctrl-${prefix.name.toUpperCase()}`;
}
