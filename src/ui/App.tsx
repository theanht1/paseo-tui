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
  HistoryEntry,
  ProviderSubagent,
  SchedulePort,
  TerminalStreamPort,
} from "../connection/ports.js";
import type { AgentsSnapshot } from "../state/agents-store.js";
import { type HostHealthEntry, healthNotices } from "../state/host-health.js";
import type {
  WorkspaceLabels,
  WorkspaceLabelsSnapshot,
} from "../state/label-catalog.js";
import { createMessageQueues } from "../state/message-queue.js";
import type { AgentsPort } from "../state/ports.js";
import type { ProviderSubagentStore } from "../state/provider-subagents.js";
import type { TimelineRegistry } from "../state/timeline-registry.js";
import {
  createTimelineStore,
  type TimelineStore,
} from "../state/timeline-store.js";
import type { UsageStore } from "../state/usage-store.js";
import { AgentPane } from "./agent/AgentPane.js";
import { shortPath } from "./agent/agent-display.js";
import {
  type ArchivedViews,
  addArchivedView,
  historyOpenTarget,
  mutatesAgent,
  pruneArchivedViews,
  removeArchivedView,
  type UnarchiveState,
  withArchivedViews,
} from "./agent/archived-views.js";
import {
  agentIndicator,
  attentionQueue,
  attentionWait,
  createAttentionTracker,
  groupIndicator,
  type Indicator,
  nextAttention,
  workspaceBucket,
} from "./agent/attention.js";
import {
  advanceHold,
  type BucketHold,
  displayedBuckets,
  releaseHold,
} from "./agent/bucket-hold.js";
import {
  type ClearedUsage,
  canClear,
  clearSessionStep,
  usageSinceClear,
} from "./agent/clear-session.js";
import { contextWindow } from "./agent/context-window.js";
import {
  filterNote,
  filterProjects,
  pruneFilter,
} from "./agent/label-filter.js";
import {
  type ReadAction,
  readAction,
  unreadWorkspaceIds,
  type WorkspaceReadActions,
} from "./agent/read-state.js";
import { Sidebar } from "./agent/Sidebar.js";
import {
  pinnedMove,
  type SidebarGrouping,
  sidebarSections,
  unpinnedOrder,
  unpinnedProjects,
} from "./agent/sidebar-sections.js";
import type { ThinkingPreference } from "./agent/thinking-preference.js";
import { labelChips } from "./agent/workspace-meta.js";
import { promptJumpStep } from "./command-center/agent-history.js";
import { CommandCenter } from "./command-center/CommandCenter.js";
import type { CreateDeps } from "./command-center/create-agent.js";
import {
  type LabelCommandContext,
  workspaceLabelsStep,
} from "./command-center/label-commands.js";
import {
  PINS_UNSUPPORTED,
  type WorkspacePinActions,
} from "./command-center/pin-commands.js";
import {
  type CommandRegistry,
  type CommandStep,
  createCommandRegistry,
} from "./command-center/registry.js";
import {
  type SessionHistory,
  type SessionHistoryContext,
  sessionHistoryStep,
} from "./command-center/session-history.js";
import {
  builtinSource,
  type ManageCommands,
} from "./command-center/sources.js";
import type { Versions } from "./command-center/version.js";
import type { UsageConfig } from "./config/user-config.js";
import {
  type ClipboardWriter,
  copyText,
  type SystemClipboard,
} from "./copy/clipboard.js";
import type { Browser } from "./file-links/browser.js";
import { type FileLinks, FileLinksContext } from "./file-links/context.js";
import { DEFAULT_FILE_EDITOR } from "./file-links/editor-terminal.js";
import {
  type ChatLink,
  type FileLink,
  fileResolver,
  timelineLinks,
} from "./file-links/links.js";
import { createPathVerifier } from "./file-links/verify.js";
import type { HostsPort } from "./hosts/hosts.js";
import { BINDINGS } from "./input/bindings.js";
import { createKeyRouter, KeyRouterContext } from "./input/key-router.js";
import {
  type Action,
  actionMode,
  type Binding,
  globalAction,
  interrupt as interruptMode,
  type Mode,
  paletteReturnMode,
  parsePrefix,
  type Stroke,
  shortcutFor,
} from "./input/keymap.js";
import { confirmQuit } from "./input/quit-confirmation.js";
import { useKeymap } from "./input/use-keymap.js";
import {
  type LabelFilterMemory,
  sessionLabelFilterMemory,
} from "./layout/label-filter-memory.js";
import type { LayoutMemory } from "./layout/layout-memory.js";
import { type OrderMemory, sessionOrderMemory } from "./layout/order-memory.js";
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
import {
  type AttentionNotification,
  createAttentionNotifier,
} from "./notify/attention-notifier.js";
import { ManagementOverlayView } from "./overlays/ManagementOverlayView.js";
import { ShortcutPopup } from "./overlays/ShortcutPopup.js";
import type { Focus } from "./permission/permission-focus.js";
import { cachedCommands } from "./prompt/command-cache.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "./render/theme.js";
import { StatusBar } from "./StatusBar.js";
import { scheduleDeps } from "./schedules/schedule-deps.js";
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
import {
  createTerminalAttention,
  terminalIndicator,
} from "./terminal/terminal-activity.js";
import { toBlocks } from "./timeline/blocks.js";
import {
  type TimelineControls,
  TimelineView,
} from "./timeline/TimelineView.js";
import { type ExternalStore, useStore } from "./use-store.js";
import { DEFAULT_DIFF_TOOL } from "./workspace/diff-tool.js";
import { WorkspaceTabs } from "./workspace/WorkspaceTabs.js";
import type { WorkspaceActions } from "./workspace/workspace-actions.js";
import type { DirectorySnapshot } from "./workspace/workspace-directory.js";
import { DEFAULT_EDITOR } from "./workspace/workspace-editor.js";
import {
  createWorkspaceNavigation,
  reconcileWorkspaceLayout,
} from "./workspace/workspace-navigation.js";
import {
  cycleTab,
  projectMove,
  projectTree,
  type SubagentTab,
  subagentTab,
  tabMove,
  type WorkspaceRow,
  type WorkspaceTab,
  workspaceMove,
  workspaceTabs,
} from "./workspace/workspaces.js";
export interface AppProps {
  label: string;
  connection: ExternalStore<ConnectionState>;
  agents: ExternalStore<AgentsSnapshot>;
  directory: ExternalStore<DirectorySnapshot>;
  terminals?: Pick<PaseoApi["terminals"], "ref">;
  terminalStream?: TerminalStreamPort;
  management?: WorkspaceActions;
  refresh?(): Promise<void>;
  /** Asks every host to rediscover its providers (Refresh providers). */
  refreshProviders?(): Promise<void>;
  thinkingPreference?: ThinkingPreference;
  timelines: TimelineRegistry;
  prefix?: Stroke;
  catalog?: Pick<
    AgentsPort,
    "providers" | "models" | "modes" | "onProvidersChange" | "create"
  >;
  commands?: CommandRegistry;
  clearAttention?(agentId: string): Promise<void>;
  /** Marks workspaces read or unread; absent without a daemon connection. */
  workspaceRead?: WorkspaceReadActions;
  /** Pins workspaces to the sidebar top; absent without a daemon connection. */
  workspacePins?: WorkspacePinActions;
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
  /** Opens chat URLs (F hints, clicks) in the local default browser. */
  browser?: Browser;
  /** True when the agent runs on another machine, so its `localhost` is not this one. */
  isRemoteAgent?(agentId: string): boolean;
  /** Provider-owned subagents; absent when the daemon lacks `providerSubagents`. */
  subagents?: Pick<
    ProviderSubagentStore,
    "getSnapshot" | "subscribe" | "track" | "timelinePort"
  >;
  /** Desktop notification for an agent that starts waiting while you look elsewhere. */
  notify?(notification: AttentionNotification): void;
  /** Shell command the diff tab runs in the workspace (`g d`). */
  diffTool?: string;
  /** Shell command the editor tab runs on the workspace (`g e`). */
  editor?: string;
  /** Command that opens a file from the chat in a terminal tab (`F`, clicks). */
  fileEditor?: string;
  /** The effective key table (defaults plus config `keys`). */
  bindings?: readonly Binding[];
  /** Per-workspace split layouts and tabs, kept across restarts. */
  layouts?: LayoutMemory;
  /** The user's project, workspace and tab order, kept across restarts. */
  order?: OrderMemory;
  /** Every host's workspace labels; absent without a daemon connection. */
  labels?: WorkspaceLabels;
  /** The sidebar's label filter, kept across restarts. */
  labelFilter?: LabelFilterMemory;
  /** Provider usage meters; absent when the daemon reports no usage. */
  usage?: UsageStore;
  usageConfig?: UsageConfig;
  /** Daemon schedules for the Command Center's Schedules view. */
  schedules?: SchedulePort;
  /** Past sessions across hosts (`H`); archived ones open view-only. */
  history?: SessionHistory;
  /** True while the jump modifier is held; the sidebar then shows each workspace's number. */
  positionHints?: ExternalStore<boolean>;
  /** Every host; absent with a single daemon connection (tests). */
  hosts?: HostsPort;
  /** Every host's health; a drop and a recovery each show one notice. */
  hostHealth?: ExternalStore<readonly HostHealthEntry[]>;
  versions?: Versions;
  /** The workspace the window shows, so host-less requests go to its host. */
  onActiveWorkspace?(workspaceId: string | null): void;
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
  refreshProviders,
  timelines,
  prefix = DEFAULT_PREFIX,
  onExit,
  commands,
  catalog,
  clearAttention = async () => {},
  workspaceRead,
  workspacePins,
  completions,
  directories,
  editPrompt,
  clipboard,
  systemClipboard,
  browser,
  isRemoteAgent = () => false,
  subagents,
  notify,
  diffTool = DEFAULT_DIFF_TOOL,
  editor = DEFAULT_EDITOR,
  fileEditor = DEFAULT_FILE_EDITOR,
  bindings = BINDINGS,
  layouts,
  order,
  labels = NO_LABELS,
  labelFilter,
  usage,
  usageConfig,
  schedules,
  history,
  positionHints = NO_HINTS,
  hosts,
  hostHealth = NO_HOST_HEALTH,
  versions,
  onActiveWorkspace,
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
  const health = useStore(hostHealth);
  const previousHealth = useRef(health);
  useEffect(() => {
    const notices = healthNotices(previousHealth.current, health);
    previousHealth.current = health;
    if (notices.length) setNotice({ text: notices.join(" · ") });
  }, [health]);
  /** Usage and schedules come from the startup host; while it is offline they wait. */
  const startupUnavailable = () =>
    connection.getSnapshot().status === "connected" ? null : HOST_UNAVAILABLE;
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
  /** A key binding's label from the effective table (`g d`, `Ctrl-B z`). */
  function shortcut(action: Action) {
    return shortcutFor(action, bindings, prefixLabel(prefix));
  }
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const { width, height } = useTerminalDimensions();
  const { groups, error } = useStore(agents);
  const directoryState = useStore(directory);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<
    ReadonlySet<string>
  >(new Set());
  const orderMemory = useMemo(() => order ?? sessionOrderMemory(), [order]);
  const storedOrder = useStore(orderMemory);
  const projects = useMemo(
    () =>
      projectTree(
        directoryState.projects,
        directoryState.workspaces.filter(
          (workspace) => !archivedWorkspaces.has(workspace.id),
        ),
        storedOrder,
      ),
    [directoryState, archivedWorkspaces, storedOrder],
  );
  const workspaces = useMemo(
    () => projects.flatMap((project) => project.workspaces),
    [projects],
  );
  const labelState = useStore(labels);
  const filterMemory = useMemo(
    () => labelFilter ?? sessionLabelFilterMemory(),
    [labelFilter],
  );
  const filterKeys = useStore(filterMemory);
  const allLabels = labelState.merged(null);
  useEffect(() => {
    filterMemory.set(
      pruneFilter(
        filterMemory.getSnapshot(),
        labelState.merged(null),
        labelState.authoritative,
      ),
    );
  }, [filterMemory, labelState]);
  const navigation = useMemo(
    () => createWorkspaceNavigation(layouts?.tabs(), orderMemory.getSnapshot),
    [layouts, orderMemory],
  );
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
  const [archivedViews, setArchivedViews] = useState<ArchivedViews>(new Map());
  const [unarchiving, setUnarchiving] = useState<
    ReadonlyMap<string, UnarchiveState>
  >(new Map());
  const archivedList = useMemo(
    () => [...archivedViews.values()],
    [archivedViews],
  );
  /** Listed agents plus open archived views: what panes and tabs look agents up in. */
  const viewable = useMemo(
    () => withArchivedViews(flat, archivedViews),
    [flat, archivedViews],
  );
  useEffect(() => {
    // An unarchived agent's live listing takes over its view (same tab slot).
    setArchivedViews((previous) => pruneArchivedViews(previous, flat));
    setUnarchiving((previous) => pruneArchivedViews(previous, flat));
  }, [flat]);
  /** The Command Center's first step when a key opens it on one (History). */
  const [paletteStep, setPaletteStep] = useState<CommandStep | undefined>();
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
  const queues = useMemo(() => createMessageQueues(timelines), [timelines]);
  useEffect(() => () => queues.close(), [queues]);
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
  /** The file each editor tab was opened with, by tab key. */
  const editorFiles = useRef(new Map<string, string>());
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
    pending.prune(panes(layout), viewable, Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Timers can fire a little before Date.now() reaches the expiry; sweep again until none is fresh.
    function sweep() {
      const now = Date.now();
      setLayout((previous) => pending.clearMissing(previous, viewable, now));
      const wait = pending.untilExpiry(now);
      if (wait !== null) timer = setTimeout(sweep, wait);
    }
    sweep();
    return () => clearTimeout(timer);
  }, [pending, viewable, layout]);
  useEffect(() => {
    paneTimelines.sync(panes(layout), viewable);
  }, [paneTimelines, layout, viewable]);
  useEffect(() => {
    if (focus.pane !== "prompt") setMode({ kind: "normal", pending: "" });
  }, [focus]);
  useEffect(() => {
    if (!numbers) return;
    const timer = setTimeout(() => setNumbers(false), 1000);
    return () => clearTimeout(timer);
  }, [numbers]);
  const activeWorkspaceId =
    workspaces.find((workspace) => workspace.id === activeWorkspace)?.id ??
    workspaces[0]?.id ??
    null;
  useEffect(() => {
    onActiveWorkspace?.(activeWorkspaceId);
  }, [onActiveWorkspace, activeWorkspaceId]);
  const offlineWorkspaces = directoryState.offline;
  const wasOffline = useRef(offlineWorkspaces);
  useEffect(() => {
    const before = wasOffline.current;
    wasOffline.current = offlineWorkspaces;
    if (!before) return;
    for (const agent of groups.flatMap((group) => group.agents))
      if (
        agent.workspaceId &&
        before.has(agent.workspaceId) &&
        !offlineWorkspaces?.has(agent.workspaceId)
      )
        timelines.reopen(agent.id);
  }, [offlineWorkspaces, groups, timelines]);
  function hostOffline(workspaceId: string | null | undefined) {
    return workspaceId ? (offlineWorkspaces?.has(workspaceId) ?? false) : false;
  }
  const tabs = workspaceTabs(
    activeWorkspaceId,
    flat,
    visibleTerminals,
    subagentTabs,
    archivedList,
    storedOrder,
  );
  const current = all.find((p) => p.id === layout.focusedId);
  useEffect(() => {
    const assigned = viewable.find((agent) => agent.id === current?.agentId);
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
      archivedList,
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
        agents: viewable,
        tab: next.tab,
        // Archived views stay put like pending agents, even if their workspace went away.
        pendingAgentIds: new Set([...pending.ids(), ...archivedViews.keys()]),
        isWorkspaceRemoved: navigation.isWorkspaceRemoved,
      }),
    );
  }, [
    navigation,
    pending,
    workspaces,
    flat,
    viewable,
    archivedList,
    archivedViews,
    visibleTerminals,
    subagentTabs,
    current?.agentId,
  ]);
  /** The workspace whose layout is on screen; switching swaps in its remembered layout. */
  const layoutOwner = useRef<string | null>(null);
  const openWorkspaceId = navigationState.workspaceId;
  const openTabKey = navigationState.tab?.key ?? null;
  useEffect(() => {
    if (!layouts) return;
    if (layoutOwner.current === openWorkspaceId) {
      if (openWorkspaceId) layouts.record(openWorkspaceId, layout, openTabKey);
      return;
    }
    layoutOwner.current = openWorkspaceId;
    if (!openWorkspaceId) return;
    const tab = navigation.getSnapshot().tab;
    const restored = layouts.restore(openWorkspaceId, {
      agentIds: new Set(flat.map((agent) => agent.id)),
      tabAgentId: tab?.kind === "agent" ? tab.agent.id : null,
    });
    if (!restored) return;
    setProviderViews(new Map());
    setLayout(restored);
  }, [layouts, navigation, openWorkspaceId, openTabKey, layout, flat]);
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
    attention.view(viewedAgent ?? null);
  }, [attention, viewedAgent]);
  const terminalAttention = useMemo(() => createTerminalAttention(), []);
  const viewedTerminals = useStore(terminalAttention);
  const viewedTerminal = directoryState.terminals.find(
    (terminal) => terminal.id === terminalId,
  );
  useEffect(() => {
    if (viewedTerminal)
      terminalAttention.view({
        id: viewedTerminal.id,
        activity: viewedTerminal.activity ?? null,
      });
  }, [terminalAttention, viewedTerminal]);
  const terminalFocused = useRef(true);
  useEffect(() => {
    const focused = () => {
      terminalFocused.current = true;
    };
    const blurred = () => {
      terminalFocused.current = false;
    };
    renderer.on("focus", focused);
    renderer.on("blur", blurred);
    return () => {
      renderer.off("focus", focused);
      renderer.off("blur", blurred);
    };
  }, [renderer]);
  const notifier = useMemo(() => createAttentionNotifier(), []);
  const liveAgents = useMemo(
    () => flat.filter((agent) => agent.archivedAt == null),
    [flat],
  );
  const viewedAgentId = viewedAgent?.id;
  useEffect(() => {
    if (!notify) return;
    for (const notification of notifier.update(
      liveAgents,
      acknowledged,
      (agentId) => terminalFocused.current && agentId === viewedAgentId,
    ))
      notify(notification);
  }, [notify, notifier, liveAgents, acknowledged, viewedAgentId]);
  const [grouping, setGrouping] = useState<SidebarGrouping>("project");
  const realBuckets = new Map(
    workspaces.map((workspace) => [
      workspace.id,
      workspaceBucket(
        liveAgents.filter((agent) => agent.workspaceId === workspace.id),
        acknowledged,
      ),
    ]),
  );
  const [bucketHold, setBucketHold] = useState<BucketHold | null>(null);
  const currentHold = advanceHold(bucketHold, activeWorkspaceId, realBuckets);
  if (currentHold !== bucketHold) setBucketHold(currentHold);
  const buckets = displayedBuckets(currentHold, realBuckets);
  const sections = sidebarSections(
    filterProjects(projects, filterKeys),
    buckets,
    grouping,
    storedOrder.pinned,
  );
  /** Workspaces in sidebar order: what j/k, [ ] and Cmd/Alt-digits walk. */
  const sidebarOrder = sections.flatMap((section) => section.workspaces);
  /** The workspace under the sidebar cursor, among the rows the filter shows. */
  const selectedWorkspace =
    sidebarOrder.find((workspace) => workspace.id === cursorWorkspace) ??
    sidebarOrder[0] ??
    null;
  const hinting = useStore(positionHints);
  const waiting = attentionQueue(liveAgents, acknowledged).map((agent) => ({
    agent,
    reason: attentionWait(agent, acknowledged)?.body ?? "",
  }));
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
      // An archived view shows no permission prompts to answer.
      if (request && agent.archivedAt == null)
        setFocus({ pane: "permission", requestId: request.id });
    }
  }
  /** A History row: a listed live agent opens as usual, anything else as a view-only archived view. */
  function openFromHistory({ agent, workspaceName }: HistoryEntry) {
    reopenAgentTab(agent.id);
    const target = historyOpenTarget(agent, flat, workspaces);
    if (target.kind === "live") {
      open(target.agent);
      return;
    }
    setArchivedViews((previous) => addArchivedView(previous, target.agent));
    setUnarchiving((previous) => {
      const next = new Map(previous);
      next.delete(target.agent.id);
      return next;
    });
    if (target.workspace) openWorkspace(target.workspace);
    else
      setNotice({
        text: `Workspace ${workspaceName ?? shortPath(agent.cwd)} is archived; showing the session here`,
      });
    // View-only: closing the Command Center must not land in insert mode.
    returnMode.current = { kind: "normal", pending: "" };
    open(target.agent);
  }
  /** A tab closed this run (archiving its agent) comes back once History opens or unarchives it. */
  function reopenAgentTab(agentId: string) {
    setClosedTabs((previous) => {
      if (!previous.has(`agent:${agentId}`)) return previous;
      const next = new Set(previous);
      next.delete(`agent:${agentId}`);
      return next;
    });
  }
  function setUnarchiveState(agentId: string, state: UnarchiveState) {
    setUnarchiving((previous) => new Map(previous).set(agentId, state));
  }
  function unarchive(agent: PaseoAgent) {
    if (!history || unarchiving.get(agent.id)?.kind === "pending") return;
    setUnarchiveState(agent.id, { kind: "pending" });
    reopenAgentTab(agent.id);
    history.unarchive(agent.id).catch((error: unknown) =>
      setUnarchiveState(agent.id, {
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
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
    const tab = navigation.selectWorkspace(
      workspace,
      flat,
      visibleTerminals,
      subagentTabs,
      archivedList,
    );
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
  const tabIndicators = new Map<string, Indicator>([
    ...flat.map((agent): [string, Indicator] => [
      `agent:${agent.id}`,
      agentIndicator(agent, acknowledged),
    ]),
    ...directoryState.terminals.map((terminal): [string, Indicator] => [
      `terminal:${terminal.id}`,
      terminalIndicator(
        { id: terminal.id, activity: terminal.activity ?? null },
        viewedTerminals,
      ),
    ]),
  ]);
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
      ? workspaceTabs(
          agent.workspaceId,
          flat,
          visibleTerminals,
          subagentTabs,
          archivedList,
          storedOrder,
        )
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
    ...(hosts ? { hosts } : {}),
    ...(directoryState.hosts
      ? {
          placements: (projectId: string) =>
            directoryState.hosts?.placements.get(projectId) ?? [],
        }
      : {}),
    notify: (text) => setNotice({ text }),
    refresh: async () => {
      await refresh?.();
    },
    archived(workspace) {
      setArchivedWorkspaces((previous) => new Set([...previous, workspace.id]));
    },
    closed(tab) {
      if (tab.kind === "agent" && archivedViews.has(tab.agent.id)) {
        setArchivedViews((previous) =>
          removeArchivedView(previous, tab.agent.id),
        );
        setMode({ kind: "normal", pending: "" });
        setFocus({ pane: "timeline" });
        return;
      }
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
      if (result.tab && result.file)
        editorFiles.current.set(result.tab.key, result.file);
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
    if (workspace) manager.openFile(workspace, link, fileEditor);
  }
  function openLink(agentId: string, link: ChatLink) {
    if (link.kind === "file") {
      openFile(agentId, link);
      return;
    }
    if (!browser) {
      setNotice({ text: `No browser to open ${link.url}` });
      return;
    }
    const local =
      isRemoteAgent(agentId) && LOCALHOST.test(new URL(link.url).hostname)
        ? "Opened locally; localhost refers to this machine"
        : null;
    void browser.open(link.url).then((error) => {
      const text = error ?? local;
      if (text) setNotice({ text });
    });
  }
  const openFileRef = useRef(openLink);
  openFileRef.current = openLink;
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
    if (focusedArchived && mutatesAgent(action)) {
      viewOnly();
      return;
    }
    // From the Command Center, an action that starts a mode returns to it on close.
    const entered = mode.kind === "palette" ? actionMode(action) : null;
    if (entered) returnMode.current = entered;
    switch (action.type) {
      case "exit":
        // Quitting loses queued messages: ask for the Ctrl-C confirmation instead.
        if (queues.total()) interrupt();
        else onExit();
        break;
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
      case "diff.open":
        setHelp(false);
        manager.openDiffTool(diffTool, visibleTerminals);
        break;
      case "workspace.editor":
        setHelp(false);
        manager.openEditor(editor, visibleTerminals);
        break;
      case "palette.open":
        manager.close();
        setHelp(false);
        if (mode.kind !== "palette") {
          setPaletteStep(undefined);
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
        if (terminalId || !timeline) {
          returnMode.current = { kind: "normal", pending: "" };
          setMode({ kind: "normal", pending: "" });
        } else controls.current.get(layout.focusedId)?.act(action);
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
        if (terminalId || !timeline) {
          returnMode.current = { kind: "normal", pending: "" };
          setMode({ kind: "normal", pending: "" });
        } else controls.current.get(layout.focusedId)?.act(action);
        break;
      case "quit":
        interrupt();
        break;
      case "tab.cycle": {
        const tab = cycleTab(tabs, tabKey, action.delta);
        if (tab) openTab(tab);
        break;
      }
      case "tab.move": {
        const change =
          activeWorkspaceId && tabKey
            ? tabMove(
                tabs,
                storedOrder,
                activeWorkspaceId,
                tabKey,
                action.delta,
              )
            : null;
        if (change) orderMemory.apply(change);
        break;
      }
      case "sidebar.move":
      case "sidebar.moveProject": {
        if (selectedWorkspace?.pinnedAt != null) {
          if (filterKeys.length) {
            setNotice({ text: "Clear the label filter to reorder" });
            break;
          }
          if (action.type === "sidebar.moveProject") {
            setNotice({ text: "Reorder pinned workspaces with J / K" });
            break;
          }
          const change = pinnedMove(
            projects,
            storedOrder,
            selectedWorkspace.id,
            action.delta,
          );
          navigation.cursor(selectedWorkspace.id);
          if (change) orderMemory.apply(change);
          break;
        }
        if (grouping === "status") {
          setNotice({ text: "Reorder in project grouping (S)" });
          break;
        }
        if (filterKeys.length) {
          setNotice({ text: "Clear the label filter to reorder" });
          break;
        }
        if (!selectedWorkspace) break;
        const move =
          action.type === "sidebar.move" ? workspaceMove : projectMove;
        const change = move(
          unpinnedProjects(projects),
          storedOrder,
          selectedWorkspace.id,
          action.delta,
        );
        // The cursor stays on the moved row.
        navigation.cursor(selectedWorkspace.id);
        if (change) orderMemory.apply(change);
        break;
      }
      case "tab.select": {
        const tab = tabs[action.index];
        if (tab) openTab(tab);
        break;
      }
      case "workspace.select": {
        const workspace = sidebarOrder[action.index];
        if (workspace) openWorkspace(workspace);
        break;
      }
      case "workspace.cycle": {
        const count = sidebarOrder.length;
        const index = sidebarOrder.findIndex(
          (workspace) => workspace.id === activeWorkspace,
        );
        const workspace =
          sidebarOrder[
            index < 0
              ? action.delta > 0
                ? 0
                : count - 1
              : (index + action.delta + count) % count
          ];
        if (workspace) openWorkspace(workspace);
        break;
      }
      case "attention.next": {
        const agent = nextAttention(
          waiting.map((entry) => entry.agent),
          terminalId ? null : (current?.agentId ?? null),
        );
        if (agent) open(agent);
        break;
      }
      case "workspace.toggleRead": {
        const kind = selectedWorkspace
          ? readActionFor(selectedWorkspace)?.kind
          : undefined;
        if (selectedWorkspace && kind) markWorkspace(selectedWorkspace, kind);
        break;
      }
      case "workspace.togglePin":
        if (selectedWorkspace) togglePin(selectedWorkspace);
        break;
      case "workspace.labels":
        if (mode.kind !== "palette" && selectedWorkspace)
          openLabels(selectedWorkspace);
        break;
      case "sidebar.toggleGrouping":
        setGrouping((value) => (value === "project" ? "status" : "project"));
        break;
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
      case "history.open":
        if (!history || mode.kind === "palette") break;
        manager.close();
        setHelp(false);
        setPaletteStep(sessionHistoryStep(historyContext(history)));
        returnMode.current = paletteReturnMode(mode);
        setMode({ kind: "palette" });
        break;
      case "agent.unarchive":
        if (focusedArchived) unarchive(focusedArchived);
        break;
      case "prompts.open": {
        if (mode.kind === "palette" || terminalId || !timeline || !focusedAgent)
          break;
        const focusedPane = all.find((pane) => pane.id === layout.focusedId);
        if (focusedPane && providerView(focusedPane)) {
          setNotice({ text: "Open the parent agent to browse its prompts" });
          break;
        }
        const step = promptJumpStep({
          agent: focusedAgent,
          store: timeline,
          goto: gotoPrompt,
        });
        if (!step) {
          setNotice({ text: "Update the Paseo daemon to browse prompts" });
          break;
        }
        manager.close();
        setHelp(false);
        setPaletteStep(step);
        returnMode.current = paletteReturnMode(mode);
        setMode({ kind: "palette" });
        break;
      }
      case "agent.clear": {
        if (mode.kind === "palette" || terminalId || !timeline) break;
        const focusedPane = all.find((pane) => pane.id === layout.focusedId);
        if (focusedPane && providerView(focusedPane)) {
          setNotice({ text: "Open the parent agent to clear its session" });
          break;
        }
        const agentId = focusedId;
        if (!agentId || !commandPort) {
          setNotice({ text: "This agent has no /clear command" });
          break;
        }
        const openClear = (step: CommandStep) => {
          manager.close();
          setHelp(false);
          setPaletteStep(step);
          returnMode.current = paletteReturnMode(mode);
          setMode({ kind: "palette" });
        };
        if (clearStep) openClear(clearStep);
        else
          commandPort.commands({ kind: "agent", agentId }).then(
            (list) => {
              if (canClear(list)) openClear(clearStepFor(agentId, timeline));
              else setNotice({ text: "This agent has no /clear command" });
            },
            (error: unknown) =>
              setNotice({
                text: `Could not list commands: ${error instanceof Error ? error.message : String(error)}`,
              }),
          );
        break;
      }
      case "queue.edit":
        if (terminalId || !timeline) break;
        // The queued text lands in the prompt, so editing continues there.
        if (mode.kind === "palette") returnMode.current = { kind: "insert" };
        else setMode({ kind: "insert" });
        setFocus({ pane: "prompt" });
        controls.current.get(layout.focusedId)?.act(action);
        break;
      case "normal":
        setFocus({ pane: "timeline" });
        break;
      case "list.move":
        navigation.moveCursor(sidebarOrder, action.delta);
        break;
      case "list.edge": {
        const next =
          action.edge === "top" ? sidebarOrder[0] : sidebarOrder.at(-1);
        if (next) navigation.cursor(next.id);
        break;
      }
      case "list.half":
        navigation.moveCursor(
          sidebarOrder,
          action.dir * Math.max(1, Math.floor(height / 2)),
        );
        break;
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
        onProvidersChange: (listener) => catalog.onProvidersChange(listener),
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
    : viewable.find((a) => a.id === current?.agentId);
  const focusedArchived =
    focusedAgent?.archivedAt != null ? focusedAgent : undefined;
  const [clearable, setClearable] = useState<ReadonlySet<string>>(new Set());
  const [clearedUsage, setClearedUsage] = useState<
    ReadonlyMap<string, ClearedUsage>
  >(new Map());
  const focusedId = focusedAgent?.id;
  const commandPort = useMemo(
    () => (completions ? cachedCommands(completions) : undefined),
    [completions],
  );
  const usedTokens = focusedAgent?.lastUsage?.contextWindowUsedTokens;
  useEffect(() => {
    if (!commandPort || !focusedId) return;
    let live = true;
    const source = { kind: "agent", agentId: focusedId } as const;
    commandPort.opened?.(source);
    commandPort.commands(source).then(
      (list) => {
        if (live && canClear(list))
          setClearable((previous) => new Set(previous).add(focusedId));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [commandPort, focusedId]);
  const focusedClearedUsage = focusedId
    ? clearedUsage.get(focusedId)
    : undefined;
  useEffect(() => {
    if (
      focusedId &&
      focusedClearedUsage &&
      focusedClearedUsage.usedTokens !== usedTokens
    )
      setClearedUsage((previous) => {
        const next = new Map(previous);
        next.delete(focusedId);
        return next;
      });
  }, [focusedId, focusedClearedUsage, usedTokens]);
  function clearStepFor(agentId: string, store: TimelineStore) {
    return clearSessionStep(store, () =>
      setClearedUsage((previous) =>
        new Map(previous).set(agentId, { usedTokens }),
      ),
    );
  }
  const clearStep =
    focusedId && timeline && clearable.has(focusedId)
      ? clearStepFor(focusedId, timeline)
      : undefined;
  function viewOnly() {
    returnMode.current = { kind: "normal", pending: "" };
    setMode({ kind: "normal", pending: "" });
    setFocus({ pane: "timeline" });
    setNotice({ text: "This agent is archived; press u to unarchive" });
  }
  /** Scrolls the focused pane to a prompt of the prompt index `epoch`. */
  function gotoPrompt(epoch: string, seq: number) {
    controls.current
      .get(layout.focusedId)
      ?.act({ type: "timeline.goto", epoch, seq });
  }
  function historyContext(source: SessionHistory): SessionHistoryContext {
    return { history: source, now: Date.now, open: openFromHistory };
  }
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
  function openLabels(workspace: WorkspaceRow) {
    const step = workspaceLabelsStep({
      ...labelContext(),
      workspaceId: workspace.id,
    });
    manager.close();
    if (typeof step === "string") {
      setNotice({ text: step });
      return;
    }
    setHelp(false);
    setPaletteStep(step);
    returnMode.current = paletteReturnMode(mode);
    setMode({ kind: "palette" });
  }
  function labelContext(): LabelCommandContext {
    return {
      labels,
      filter: filterMemory,
      workspace: selectedWorkspace,
      row: (id) =>
        directory.getSnapshot().workspaces.find((row) => row.id === id),
      subscribeRows: directory.subscribe,
      report: (text) => setNotice({ text }),
    };
  }
  function manageCommands(): ManageCommands {
    return {
      workspace:
        workspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
        null,
      hosts: hosts !== undefined,
      archiveWorkspace: (workspace) => manager.archiveWorkspace(workspace),
      addProject: () => manager.addProject(),
      listProjects: () => manager.listProjects(),
      removeProject: () => manager.removeProject(),
      listHosts: () => manager.listHosts(),
      addHost: () => manager.addHost(),
      forkWorkspace: (seed) => manager.seededWorkspaceStep(seed),
    };
  }
  function workspacePaths() {
    const workspace = workspaces.find(
      (candidate) => candidate.id === activeWorkspaceId,
    );
    return {
      workspace: workspace
        ? (workspace.workspaceDirectory ?? workspace.projectRootPath)
        : null,
      file: terminalId
        ? (editorFiles.current.get(`terminal:${terminalId}`) ?? null)
        : null,
      copy,
    };
  }
  function reportFailure(error: unknown) {
    setNotice({ text: error instanceof Error ? error.message : String(error) });
  }
  function readActionFor(workspace: WorkspaceRow) {
    return workspaceRead
      ? readAction(
          buckets.get(workspace.id) ?? "done",
          workspaceRead.canMarkUnread(workspace.id),
        )
      : null;
  }
  function markWorkspace(workspace: WorkspaceRow, kind: ReadAction["kind"]) {
    if (!workspaceRead) return;
    if (kind === "read") {
      setBucketHold(releaseHold(currentHold, [workspace.id]));
      workspaceRead.markRead([workspace.id]).catch(reportFailure);
      return;
    }
    if (viewedAgent?.workspaceId === workspace.id) attention.hold(viewedAgent);
    workspaceRead.markUnread(workspace.id).then(
      () => attention.settle(),
      (error: unknown) => {
        attention.release();
        reportFailure(error);
      },
    );
  }
  function setPinned(workspace: WorkspaceRow, pinned: boolean) {
    if (!workspacePins?.canPin(workspace.id)) {
      setNotice({ text: PINS_UNSUPPORTED });
      return;
    }
    workspacePins.setPinned(workspace.id, pinned).then(() => {
      const change = pinned
        ? null
        : unpinnedOrder(orderMemory.getSnapshot(), workspace.id);
      if (change) orderMemory.apply(change);
    }, reportFailure);
  }
  function togglePin(workspace: WorkspaceRow) {
    setPinned(workspace, workspace.pinnedAt == null);
  }
  function markAllRead() {
    const ids = unreadWorkspaceIds(buckets);
    if (workspaceRead && ids.length) {
      setBucketHold(releaseHold(currentHold, ids));
      workspaceRead.markRead(ids).catch(reportFailure);
    }
  }
  const refreshAllProviders = refreshProviders
    ? () => {
        setNotice({ text: "Refreshing providers…" });
        refreshProviders().then(
          () => setNotice({ text: "Providers refreshed" }),
          (error: unknown) =>
            setNotice({
              text: `Refresh providers failed: ${error instanceof Error ? error.message : String(error)}`,
            }),
        );
      }
    : undefined;
  /** The builtin Command Center source's view of this render. */
  function builtinContext() {
    return {
      version: versions ? { versions, hosts: hostHealth } : undefined,
      files: chatFiles,
      createAgent,
      groups,
      waiting,
      workspaces,
      focusedAgent,
      focusedStore: terminalId ? null : timeline,
      queued:
        focusedAgent && !terminalId
          ? queues.forAgent(focusedAgent).getSnapshot().items.length
          : 0,
      models: catalog?.models,
      prefixLabel: prefixLabel(prefix),
      bindings,
      schedules:
        schedules &&
        scheduleDeps(schedules, {
          notify: (text) => setNotice({ text }),
          agents: flat,
          focusedAgent,
          open,
          createAgent,
          unavailable: startupUnavailable,
        }),
      usage,
      usageConfig,
      unavailable: startupUnavailable,
      paths: workspacePaths(),
      manage: manageCommands(),
      labels: labelContext(),
      read: workspaceRead && {
        workspace: selectedWorkspace,
        action: selectedWorkspace ? readActionFor(selectedWorkspace) : null,
        unread: unreadWorkspaceIds(buckets).length,
        mark: markWorkspace,
        markAll: markAllRead,
      },
      pins: workspacePins && {
        workspace: selectedWorkspace,
        canPin: (id: string) => workspacePins.canPin(id),
        toggle: togglePin,
      },
      history: history && historyContext(history),
      clear: clearStep,
      clearedUsage: focusedClearedUsage,
      unarchive() {
        if (focusedArchived) unarchive(focusedArchived);
      },
      goto: gotoPrompt,
      refreshProviders: refreshAllProviders,
      open,
      changeLayout: setLayout,
      workspace(workspace: WorkspaceRow) {
        setSidebarVisible(true);
        openWorkspace(workspace);
      },
      act,
    };
  }
  const builtin = builtinContext();
  const sourceContext = useRef(builtin);
  sourceContext.current = builtin;
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
    const always = globalAction(event, bindings);
    if (always) {
      event.preventDefault();
      event.stopPropagation();
      act(always);
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
    bindings,
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
                sections={sections}
                labels={(workspace) =>
                  labelChips(workspace, labelState.host(workspace.id))
                }
                pending={
                  new Map(
                    workspaces.map((workspace) => [
                      workspace.id,
                      liveAgents
                        .filter((agent) => agent.workspaceId === workspace.id)
                        .reduce(
                          (sum, agent) => sum + agent.pendingPermissions.length,
                          0,
                        ),
                    ]),
                  )
                }
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
                {...(directoryState.hosts
                  ? { hosts: directoryState.hosts.labels }
                  : {})}
                {...(directoryState.offline
                  ? { offline: directoryState.offline }
                  : {})}
                positions={
                  hinting
                    ? new Map(
                        sidebarOrder
                          .slice(0, 9)
                          .map((workspace, index) => [workspace.id, index + 1]),
                      )
                    : undefined
                }
              />
            ) : null}
            <box width={area.width} height={area.height} flexDirection="column">
              {terminalId ? (
                <WorkspaceTabs
                  id="pane-tabs:terminal"
                  width={area.width}
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
              {terminalHandle &&
              terminalStream &&
              hostOffline(activeWorkspaceId) ? (
                <text fg={foregroundProp(theme.muted)}>{HOST_OFFLINE}</text>
              ) : terminalHandle && terminalStream ? (
                <TerminalPane
                  key={terminalHandle.id}
                  terminal={terminalHandle}
                  stream={terminalStream}
                  paneFocused={focus.pane !== "list" && !overlayOpen}
                  onFocus={() => {
                    if (focus.pane === "list") setFocus({ pane: "timeline" });
                  }}
                  onExit={() => {
                    // Close now; the daemon's terminal list drops it a moment later.
                    const key = `terminal:${terminalHandle.id}`;
                    setClosedTabs((previous) => new Set([...previous, key]));
                    void refresh?.();
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
                    const agent = viewable.find((a) => a.id === pane.agentId);
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
                        ) : agent && hostOffline(agent.workspaceId) ? (
                          <text fg={foregroundProp(theme.muted)}>
                            {HOST_OFFLINE}
                          </text>
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
                            completions={commandPort}
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
                            unarchive={unarchiving.get(agent.id)}
                            onUnarchive={() => unarchive(agent)}
                            queue={queues.forAgent(agent)}
                            shortcut={shortcut}
                            stopShortcut={
                              shortcut({ type: "stop" }) ?? "the stop key"
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
              bindings={bindings}
              onClose={() => setHelp(false)}
            />
          ) : null}
          <ManagementOverlayView
            overlay={managementState.overlay}
            manager={manager}
            registry={registry}
            completions={commandPort}
            onLabels={openLabels}
            canPin={(workspace) => workspacePins?.canPin(workspace.id) ?? false}
            onPin={(workspace, pinned) => {
              manager.close();
              setPinned(workspace, pinned);
            }}
          />
          {mode.kind === "palette" ? (
            <CommandCenter
              registry={registry}
              initialStep={paletteStep}
              completions={commandPort}
              shortcut={shortcut}
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
              queued: quitNotice === null ? 0 : queues.total(),
              notice: notice?.text ?? null,
              operation:
                managementState.operation.kind === "idle"
                  ? null
                  : managementState.operation.message,
              createError: createError?.message ?? null,
              filter: filterNote(filterKeys, allLabels),
            })}
            connection={connection}
            usage={usage}
            usageConfig={usageConfig}
            contextWindow={contextWindow(
              usageSinceClear(focusedAgent?.lastUsage, focusedClearedUsage),
            )}
            timeline={terminalId ? null : timeline}
            mode={mode}
            terminalInput={terminalInput}
            context={focus.pane === "list" ? "sidebar" : "pane"}
            searchStatus={searchStatuses.get(layout.focusedId) ?? ""}
            bindings={bindings}
          />
        </box>
      </KeyRouterContext>
    </FileLinksContext>
  );
}
const DEFAULT_PREFIX = parsePrefix("C-b");
const LOCALHOST = /^(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0)$/i;
const NO_LABEL_VIEW: WorkspaceLabelsSnapshot = {
  host: () => ({ kind: "unsupported" }),
  merged: () => [],
  catalogs: [],
  failed: [],
  supported: false,
  authoritative: false,
};
const NO_LABELS: WorkspaceLabels = {
  subscribe: () => () => {},
  getSnapshot: () => NO_LABEL_VIEW,
  setAssignment: noHost,
  update: noHost,
  inspectDelete: noHost,
  delete: noHost,
  reload: noHost,
};
async function noHost(): Promise<never> {
  throw Error("No host is connected");
}
const NO_HINTS: ExternalStore<boolean> = {
  subscribe: () => () => {},
  getSnapshot: () => false,
};
const NO_PROVIDER_SUBAGENTS: readonly ProviderSubagent[] = [];
const NO_HEALTH: readonly HostHealthEntry[] = [];
const NO_HOST_HEALTH: ExternalStore<readonly HostHealthEntry[]> = {
  subscribe: () => () => {},
  getSnapshot: () => NO_HEALTH,
};
const HOST_UNAVAILABLE = "Unavailable · host offline, reconnecting…";
const HOST_OFFLINE = "host offline, reconnecting…";
const NO_SUBAGENTS: ExternalStore<readonly ProviderSubagent[]> = {
  subscribe: () => () => {},
  getSnapshot: () => NO_PROVIDER_SUBAGENTS,
};
function prefixLabel(prefix: Stroke) {
  return `Ctrl-${prefix.name.toUpperCase()}`;
}
