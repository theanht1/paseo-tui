import type { ConnectionState, PaseoAgent } from "@getpaseo/client";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AgentsSnapshot } from "../state/agents-store.js";
import type { TimelineRegistry } from "../state/timeline-registry.js";
import type { createTimelineStore } from "../state/timeline-store.js";
import { AgentList } from "./AgentList.js";
import { AgentPane } from "./AgentPane.js";
import { CommandCenter } from "./command-center/CommandCenter.js";
import {
  type CommandRegistry,
  createCommandRegistry,
} from "./command-center/registry.js";
import { builtinSource } from "./command-center/sources.js";
import {
  type Action,
  helpRows,
  type Mode,
  parsePrefix,
  type Stroke,
} from "./input/keymap.js";
import { useKeymap } from "./input/use-keymap.js";
import {
  assign,
  close,
  computeRects,
  focusDirection,
  focusIndex,
  focusNext,
  initialLayout,
  panes,
  split,
  toggleZoom,
} from "./layout/split-tree.js";
import type { Focus } from "./permission-focus.js";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "./render/theme.js";
import { StatusBar } from "./StatusBar.js";
import type { TimelineControls } from "./timeline/TimelineView.js";
import { type ExternalStore, useStore } from "./use-store.js";
export type TimelineStore = ReturnType<typeof createTimelineStore>;
export interface AppProps {
  label: string;
  connection: ExternalStore<ConnectionState>;
  agents: ExternalStore<AgentsSnapshot>;
  timelines: TimelineRegistry;
  prefix?: Stroke;
  commands?: CommandRegistry;
  onExit(): void;
}
export function App({
  label,
  connection,
  agents,
  timelines,
  prefix = DEFAULT_PREFIX,
  onExit,
  commands,
}: AppProps) {
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
  const flat = useMemo(() => groups.flatMap((g) => g.agents), [groups]);
  const [layout, setLayout] = useState(initialLayout),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ pane: "list" }),
    [mode, setMode] = useState<Mode>({ kind: "normal", pending: "" });
  const [help, setHelp] = useState(false),
    [sidebarVisible, setSidebarVisible] = useState(true),
    [numbers, setNumbers] = useState(false);
  const [searchStatuses, setSearchStatuses] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  const controls = useRef(new Map<string, TimelineControls>());
  const holders = useRef(
    new Map<string, ReturnType<TimelineRegistry["acquire"]>>(),
  );
  const [stores, setStores] = useState<ReadonlyMap<string, TimelineStore>>(
    new Map(),
  );
  const all = panes(layout);
  useEffect(() => {
    for (const pane of panes(layout)) {
      if (!pane.agentId) continue;
      const key = `${pane.id}:${pane.agentId}`;
      if (!holders.current.has(key)) {
        const agent = flat.find((a) => a.id === pane.agentId);
        if (agent) holders.current.set(key, timelines.acquire(agent));
      }
    }
    for (const [key, holder] of holders.current)
      if (!panes(layout).some((p) => `${p.id}:${p.agentId}` === key)) {
        holder.release();
        holders.current.delete(key);
      }
    function refresh() {
      setStores(
        new Map(
          [...holders.current].map(([key, holder]) => [key, holder.store]),
        ),
      );
    }
    refresh();
    return timelines.subscribe(refresh);
  }, [layout, flat, timelines]);
  useEffect(
    () => () => {
      for (const holder of holders.current.values()) holder.release();
      holders.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (focus.pane !== "prompt") setMode({ kind: "normal", pending: "" });
  }, [focus]);
  useEffect(() => {
    if (!numbers) return;
    const timer = setTimeout(() => setNumbers(false), 1000);
    return () => clearTimeout(timer);
  }, [numbers]);
  const selected = flat.find((a) => a.id === selectedId) ?? flat[0] ?? null;
  const current = all.find((p) => p.id === layout.focusedId);
  const timeline = current
    ? (stores.get(`${current.id}:${current.agentId}`) ?? null)
    : null;
  function open(agent: PaseoAgent) {
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
  const sidebarWidth = sidebarVisible
    ? Math.max(28, Math.floor(width * 0.3))
    : 0;
  const area = {
    x: 0,
    y: 0,
    width: Math.max(0, width - sidebarWidth),
    height: Math.max(0, height - 1 - (error ? 1 : 0)),
  };
  const rects = computeRects(layout, area);
  function act(action: Action) {
    switch (action.type) {
      case "palette.open":
        if (mode.kind !== "palette") {
          returnMode.current =
            mode.kind === "prefix"
              ? mode.returnTo === "insert"
                ? { kind: "insert" }
                : { kind: "normal", pending: "" }
              : mode;
          setMode({ kind: "palette" });
        }
        break;
      case "quit":
        onExit();
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
        if (timeline) setFocus({ pane: "prompt" });
        break;
      case "normal":
        setFocus({ pane: "timeline" });
        break;
      case "list.move": {
        const i = flat.findIndex((a) => a.id === selected?.id);
        const next =
          flat[Math.max(0, Math.min(flat.length - 1, i + action.delta))];
        if (next) setSelectedId(next.id);
        break;
      }
      case "list.edge": {
        const next = action.edge === "top" ? flat[0] : flat.at(-1);
        if (next) setSelectedId(next.id);
        break;
      }
      case "list.open":
        if (selected) open(selected);
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
      case "pane.numbers":
        setNumbers(true);
        break;
      default:
        controls.current.get(layout.focusedId)?.act(action);
    }
  }
  const sourceContext = useRef({
    groups,
    focusedAgent: flat.find((a) => a.id === current?.agentId),
    prefixLabel: prefixLabel(prefix),
    open,
    changeLayout: setLayout,
    workspace(agentId: string) {
      setSidebarVisible(true);
      setFocus({ pane: "list" });
      setSelectedId(agentId);
    },
    act,
  });
  sourceContext.current = {
    ...sourceContext.current,
    groups,
    focusedAgent: flat.find((a) => a.id === current?.agentId),
    prefixLabel: prefixLabel(prefix),
    open,
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
  useKeyboard((event) => {
    if (event.ctrl && event.name === "k") {
      event.preventDefault();
      event.stopPropagation();
      act({ type: "palette.open" });
      return;
    }
    if (event.ctrl && event.name === "c") {
      event.preventDefault();
      onExit();
      return;
    }
    if (
      help &&
      (event.name === "escape" ||
        event.sequence === "?" ||
        event.sequence === "q")
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.sequence === "q") onExit();
      else setHelp(false);
    }
  });
  useKeymap(
    numbers ? { kind: "prefix" } : mode,
    focus.pane === "list" ? "sidebar" : "pane",
    setMode,
    act,
    !help && mode.kind !== "palette" && focus.pane !== "permission",
    prefix,
  );
  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={theme.fg ? undefined : backgroundProp(theme.codeBg)}
    >
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        {sidebarVisible ? (
          <box
            width={sidebarWidth}
            border={["right"]}
            borderColor={foregroundProp(theme.border)}
            flexShrink={0}
          >
            <AgentList
              groups={groups}
              selectedId={selected?.id ?? null}
              openId={current?.agentId ?? null}
              onSelect={(id) => {
                setSelectedId(id);
                setFocus({ pane: "list" });
              }}
              onOpen={open}
            />
          </box>
        ) : null}
        <box width={area.width} height={area.height}>
          {all.map((pane, index) => {
            const rect =
              layout.zoomedId === pane.id ? area : rects.get(pane.id);
            if (!rect) return null;
            const agent = flat.find((a) => a.id === pane.agentId);
            const store = stores.get(`${pane.id}:${pane.agentId}`);
            return (
              <box
                key={pane.id}
                id={`pane:${pane.id}`}
                position="absolute"
                left={rect.x}
                top={rect.y}
                width={rect.width}
                height={rect.height}
                visible={!layout.zoomedId || layout.zoomedId === pane.id}
                border
                borderColor={foregroundProp(
                  pane.id === layout.focusedId
                    ? theme.borderFocused
                    : theme.border,
                )}
                flexDirection="column"
                onMouseDown={() => {
                  if (pane.id !== layout.focusedId) {
                    setLayout((l) => focusIndex(l, index));
                    setFocus({ pane: "timeline" });
                  }
                }}
              >
                {numbers ? (
                  <text fg={foregroundProp(theme.fg)}>{index}</text>
                ) : null}
                {agent && store ? (
                  <AgentPane
                    key={`${agent.id}`}
                    store={store}
                    agent={agent}
                    focused={
                      pane.id === layout.focusedId &&
                      !help &&
                      (mode.kind !== "palette" ||
                        returnMode.current.kind === "insert")
                    }
                    focus={focus}
                    mode={mode.kind === "palette" ? returnMode.current : mode}
                    setFocus={setFocus}
                    setMode={setMode}
                    height={rect.height - 2}
                    prefix={prefix}
                    controls={(value) => {
                      if (value) controls.current.set(pane.id, value);
                      else controls.current.delete(pane.id);
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
                    No agent. Pick one in the sidebar (Tab) or Ctrl-K.
                  </text>
                )}
              </box>
            );
          })}
        </box>
      </box>
      {help ? (
        <box
          position="absolute"
          left={0}
          top={0}
          width={width}
          height={Math.max(1, height - 1)}
          backgroundColor={backgroundProp(theme.codeBg)}
          zIndex={10}
        >
          <scrollbox
            scrollbarOptions={scrollbarOptions(theme)}
            flexGrow={1}
            focused
            scrollX={false}
          >
            <text fg={foregroundProp(theme.fg)}>Keyboard shortcuts</text>
            {helpRows(prefixLabel(prefix))
              .sort(
                (a, b) =>
                  Number(a.section === prefixLabel(prefix)) -
                  Number(b.section === prefixLabel(prefix)),
              )
              .map((row) => (
                <text
                  fg={foregroundProp(theme.fg)}
                  key={`${row.section}:${row.keys}`}
                >
                  {row.section}: {row.keys} · {row.description}
                </text>
              ))}
            <text fg={foregroundProp(theme.fg)}>
              Permission: 1–9 choose · y allow / n deny · Esc defer
            </text>
            <text fg={foregroundProp(theme.fg)}>
              Insert: Enter send · Shift-Enter / Ctrl-J newline
            </text>
          </scrollbox>
        </box>
      ) : null}
      {mode.kind === "palette" ? (
        <CommandCenter
          registry={registry}
          onClose={() => setMode(returnMode.current)}
        />
      ) : null}
      {error ? (
        <text fg={foregroundProp(theme.error)}>Agent list error: {error}</text>
      ) : null}
      <StatusBar
        label={label}
        connection={connection}
        timeline={timeline}
        mode={mode}
        context={focus.pane === "list" ? "sidebar" : "pane"}
        searchStatus={searchStatuses.get(layout.focusedId) ?? ""}
      />
    </box>
  );
}
const DEFAULT_PREFIX = parsePrefix("C-b");
function prefixLabel(prefix: Stroke) {
  return `Ctrl-${prefix.name.toUpperCase()}`;
}
