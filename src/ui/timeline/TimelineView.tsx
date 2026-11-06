import { extname } from "node:path";
import type { PaseoAgent } from "@getpaseo/client";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import {
  type BoxRenderable,
  type CliRenderer,
  type ScrollBoxRenderable,
  TextAttributes,
} from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { createTwoFilesPatch } from "diff";
import {
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TimelineStore } from "../../state/timeline-store.js";
import { agentName, shortPath } from "../agent/agent-display.js";
import { WorkingIndicator } from "../agent/WorkingIndicator.js";
import {
  type CopyEffect,
  type CopyState,
  copyKey,
  rebaseCopy,
  scrollCopy,
  startCopy,
} from "../copy/copy-mode.js";
import { FileLinksContext } from "../file-links/context.js";
import {
  assignHints,
  type HintState,
  hintKey,
  screenSpots,
} from "../file-links/hints.js";
import {
  type ChatLink,
  type FileResolver,
  fileResolver,
  linkifyMarkdown,
  markdownUrlLabels,
  timelineLinks,
} from "../file-links/links.js";
import type { PathVerifier } from "../file-links/verify.js";
import type { Action } from "../input/keymap.js";
import { Markdown } from "../render/markdown.js";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import { useStore } from "../use-store.js";
import {
  type Block,
  isExpandable,
  planLabel,
  toBlocks,
  toolGlyph,
  toolSummary,
} from "./blocks.js";
import { CopyView } from "./CopyView.js";
import { copyDocument } from "./copy-document.js";
import { setAll, toggle } from "./expansion.js";
import {
  combineMatches,
  createHistorySearch,
  createRevealTracker,
  nextTarget,
  type SearchTarget,
  searchStatus,
  targetIndex,
} from "./history-search.js";
import { promptTarget } from "./prompt-jump.js";
import { findMatches } from "./search.js";

function code(text: string, lang = "") {
  const fence = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
  );
  return `${fence}${lang}\n${text}\n${fence}`;
}
function capped(text: string, limit: number, tail = false) {
  const lines = text.split("\n");
  return lines.length > limit
    ? `… ${lines.length - limit} ${tail ? "earlier" : "more"} lines\n${(tail ? lines.slice(-limit) : lines.slice(0, limit)).join("\n")}`
    : text;
}
function ToolDetail({ detail }: { detail: ToolCallDetail }) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  switch (detail.type) {
    case "shell":
      return (
        <box flexDirection="column">
          <Markdown text={code(`$ ${detail.command}`, "bash")} />
          <text fg={foregroundProp(context.theme.fg)}>
            {capped(detail.output ?? "", 200, true)}
          </text>
        </box>
      );
    case "edit": {
      const patch =
        detail.unifiedDiff ??
        (detail.oldString !== undefined && detail.newString !== undefined
          ? createTwoFilesPatch(
              detail.filePath,
              detail.filePath,
              detail.oldString,
              detail.newString,
            )
          : null);
      return patch ? (
        <diff
          diff={patch}
          view="unified"
          filetype={extname(detail.filePath).slice(1)}
          syntaxStyle={context.syntaxStyle}
          fg={foregroundProp(context.theme.fg)}
          addedBg={backgroundProp(context.theme.selectionBg)}
          removedBg={backgroundProp(context.theme.codeBg)}
          addedSignColor={foregroundProp(context.theme.success)}
          removedSignColor={foregroundProp(context.theme.error)}
        />
      ) : (
        <text fg={foregroundProp(context.theme.fg)}>{detail.filePath}</text>
      );
    }
    case "read":
    case "write":
      return (
        <Markdown
          text={code(
            capped(detail.content ?? "", 400),
            extname(detail.filePath).slice(1),
          )}
        />
      );
    case "search":
      return (
        <text fg={foregroundProp(context.theme.fg)}>
          {detail.query}
          {"\n"}
          {detail.content}
        </text>
      );
    case "fetch":
      return <text fg={foregroundProp(context.theme.fg)}>{detail.url}</text>;
    case "plan":
      return <Markdown text={detail.text} />;
    case "plain_text":
      return <Markdown text={detail.text ?? detail.label ?? ""} />;
    case "sub_agent":
      return (
        <text fg={foregroundProp(context.theme.fg)}>{detail.description}</text>
      );
    default:
      return null;
  }
}
function filePath(detail: ToolCallDetail): string | null {
  return detail.type === "read" ||
    detail.type === "edit" ||
    detail.type === "write"
    ? detail.filePath
    : null;
}
export function UserMessage({ text }: { text: string }) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  return (
    <box
      backgroundColor={backgroundProp(theme.userBg)}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      <text fg={foregroundProp(theme.user)}>
        <strong>You</strong>
      </text>
      <text fg={foregroundProp(theme.user)}>
        <strong>{text}</strong>
      </text>
    </box>
  );
}

function BlockBody({
  block,
  expanded,
  streaming,
  onToggle,
  linkify,
}: {
  block: Block;
  expanded: boolean;
  streaming: boolean;
  onToggle(event: { x: number; y: number }): void;
  /** Present when file links are enabled. */
  linkify: ((text: string) => string) | null;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  switch (block.kind) {
    case "assistant":
      return (
        <Markdown
          text={linkify ? linkify(block.text) : block.text}
          streaming={streaming}
        />
      );
    case "user":
      return <UserMessage text={block.text} />;
    case "reasoning":
      return (
        <box flexDirection="column">
          <text fg={foregroundProp(theme.reasoning)} onMouseDown={onToggle}>
            ∴ thinking · {block.text.split("\n").length} lines
          </text>
          {expanded ? <Markdown text={block.text} dim /> : null}
        </box>
      );
    case "tool": {
      const status = block.call.status;
      return (
        <box flexDirection="column">
          <text
            wrapMode="none"
            fg={foregroundProp(
              status === "running"
                ? theme.warn
                : status === "completed"
                  ? theme.success
                  : status === "failed"
                    ? theme.error
                    : theme.muted,
            )}
            onMouseDown={onToggle}
          >
            {toolGlyph(status)} {block.call.name}{" "}
            {linkify && filePath(block.call.detail) ? (
              <span
                fg={foregroundProp(theme.accent)}
                attributes={TextAttributes.UNDERLINE}
              >
                {filePath(block.call.detail)}
              </span>
            ) : (
              toolSummary(block.call.detail).replace(/\s+/g, " ")
            )}
          </text>
          {expanded ? <ToolDetail detail={block.call.detail} /> : null}
        </box>
      );
    }
    case "plan":
      return (
        <box flexDirection="column">
          <text
            wrapMode="none"
            fg={foregroundProp(
              block.outcome === "approved"
                ? theme.success
                : block.outcome === "proposed"
                  ? theme.accent
                  : theme.muted,
            )}
            onMouseDown={onToggle}
          >
            {expanded ? "▾" : "▸"} {planLabel(block.outcome)}
          </text>
          {expanded ? <Markdown text={block.text} /> : null}
        </box>
      );
    case "todo":
      return (
        <box flexDirection="column">
          {Array.from(block.items.entries()).map(([i, item]) => (
            <text
              key={`${i}:${item.text}`}
              fg={foregroundProp(item.completed ? theme.muted : theme.fg)}
              attributes={item.completed ? TextAttributes.STRIKETHROUGH : 0}
            >
              {item.completed ? "☑" : "☐"} {item.text}
            </text>
          ))}
        </box>
      );
    case "error":
      return <text fg={foregroundProp(theme.error)}>! {block.message}</text>;
    case "notice":
      return (
        <text wrapMode="none" fg={foregroundProp(theme.muted)}>
          {block.text.replace(/\s+/g, " ")}
        </text>
      );
    case "unknown":
      return <text fg={foregroundProp(theme.muted)}>[{block.type}]</text>;
  }
}
export interface TimelineControls {
  act(action: Action): void;
}
/** Header fields; a provider subagent supplies them from its descriptor. */
export type TimelineAgent = Pick<
  PaseoAgent,
  | "id"
  | "title"
  | "provider"
  | "model"
  | "availableModes"
  | "currentModeId"
  | "status"
  | "cwd"
  | "activeTurn"
>;
export function TimelineView({
  store,
  agent,
  focused,
  paneFocused,
  controls,
  onSearchStatus,
  copying = false,
  onCopy = () => {},
  hinting = false,
  onHintDone = () => {},
}: {
  store: TimelineStore;
  agent: TimelineAgent;
  focused: boolean;
  paneFocused: boolean;
  controls: Ref<TimelineControls>;
  onSearchStatus: (status: string) => void;
  copying?: boolean;
  onCopy?(effect: Exclude<CopyEffect, { kind: "none" | "file" }>): void;
  /** File-hint mode is active for this pane. */
  hinting?: boolean;
  onHintDone?(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const renderer = useRenderer();
  const files = useContext(FileLinksContext);
  const snapshot = useStore(store);
  const { blocks, owners } = useMemo(() => {
    const owners = new Map<number, string>();
    return { blocks: toBlocks(snapshot.rows, owners), owners };
  }, [snapshot.rows]);
  /** One page-in at a time per pane, shared by search matches and prompt jumps. */
  const reveals = useMemo(() => createRevealTracker(store.reveal), [store]);
  const historySearch = useMemo(
    () => createHistorySearch(store.search, reveals),
    [store, reveals],
  );
  const searched = useStore(historySearch);
  const links = useMemo(
    () => timelineLinks(blocks, agent.cwd),
    [blocks, agent.cwd],
  );
  const urlLabels = useMemo(() => markdownUrlLabels(blocks), [blocks]);
  useEffect(() => {
    files?.verifier.request(
      links.filter((link) => link.source === "text").map((link) => link.path),
    );
  }, [files, links]);
  const verified = useStore(files?.verifier ?? NO_VERIFIER);
  const resolver = useMemo(
    () =>
      files
        ? fileResolver(
            links,
            agent.cwd,
            (path) => verified >= 0 && files.verifier.status(path) === "file",
            urlLabels,
          )
        : null,
    [files, links, agent.cwd, verified, urlLabels],
  );
  const root = useRef<BoxRenderable>(null);
  const [hint, setHint] = useState<HintState<ChatLink> | null>(null);
  const hintRef = useRef(hint);
  hintRef.current = hint;
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;
  const onHintDoneRef = useRef(onHintDone);
  onHintDoneRef.current = onHintDone;
  useEffect(() => {
    if (!hinting) setHint(null);
  }, [hinting]);
  function open(link: ChatLink) {
    files?.open(agent.id, link);
  }
  const openRef = useRef(open);
  openRef.current = open;
  /** Opens the link drawn at a screen cell; false when there is none. */
  function openAt(x: number, y: number): boolean {
    const row = screenRows(renderer)[y];
    if (!resolver || row === undefined) return false;
    const link = resolver.resolveAt(
      row,
      Array.from(row).slice(0, x).join("").length,
    );
    if (link) open(link);
    return link !== null;
  }
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedKey, select] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const targets = useMemo(
    () =>
      combineMatches({
        blocks,
        owners,
        rows: snapshot.rows,
        epoch: snapshot.epoch,
        local: findMatches(blocks, query),
        history: searched.history,
      }),
    [blocks, owners, snapshot.rows, snapshot.epoch, query, searched.history],
  );
  const current = useRef({
    blocks,
    owners,
    epoch: snapshot.epoch,
    expanded,
    selectedKey,
    targets,
    pending: searched.pending,
  });
  current.current = {
    blocks,
    owners,
    epoch: snapshot.epoch,
    expanded,
    selectedKey,
    targets,
    pending: searched.pending,
  };
  /** Selects, expands and scrolls to a block. */
  const jump = useCallback(function jump(key: string) {
    current.current.selectedKey = key;
    select(key);
    const expanded = new Set(current.current.expanded).add(key);
    current.current.expanded = expanded;
    setExpanded(expanded);
    scroll.current?.scrollChildIntoView(key);
  }, []);
  /** Jumps to a match, paging older history in first when it is not loaded. */
  const go = useCallback(
    function go(target: SearchTarget | null) {
      if (!target) return;
      const key =
        target.kind === "loaded"
          ? target.key
          : current.current.owners.get(target.seq);
      if (key) jump(key);
      else if (target.kind === "unloaded") historySearch.reveal(target.seq);
    },
    [jump, historySearch],
  );
  /** Set when a committed search found nothing loaded; the daemon's newest match is used. */
  const awaitingHistory = useRef(false);
  useEffect(() => {
    const pending = searched.pending;
    const key = pending === null ? undefined : owners.get(pending);
    if (key) {
      historySearch.shown();
      jump(key);
    }
  }, [owners, searched.pending, historySearch, jump]);
  useEffect(() => {
    if (!awaitingHistory.current || searched.history.kind === "searching")
      return;
    awaitingHistory.current = false;
    go(targets.at(-1) ?? null);
  }, [searched.history, targets, go]);
  const selectCurrent = useCallback(function selectCurrent(key: string) {
    current.current.selectedKey = key;
    select(key);
  }, []);
  const expandCurrent = useCallback(function expandCurrent(
    value: ReadonlySet<string>,
  ) {
    current.current.expanded = value;
    setExpanded(value);
  }, []);
  const draft = useRef("");
  const [copy, setCopy] = useState<CopyState | null>(null);
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const onCopyRef = useRef(onCopy);
  onCopyRef.current = onCopy;
  useEffect(() => {
    if (!copying) setCopy(null);
  }, [copying]);
  const olderRef = useRef(store.older);
  olderRef.current = store.older;
  /** The width and first block of the copy document, to rebuild it when history pages in. */
  const copyLayout = useRef<{ width: number; first: string | null }>({
    width: 1,
    first: null,
  });
  useEffect(() => {
    const state = copyRef.current;
    if (!state) return;
    const { width, first } = copyLayout.current;
    const doc = copyDocument(blocks, expanded, width);
    const shift = first === null ? 0 : (doc.starts.get(first) ?? 0);
    copyLayout.current = { width, first: blocks[0]?.key ?? null };
    const next = rebaseCopy(state, doc.lines, shift);
    copyRef.current = next;
    setCopy(next);
  }, [blocks, expanded]);
  useEffect(() => {
    onSearchStatus(
      searchStatus({
        query,
        targets,
        index: targetIndex(targets, selectedKey, searched.pending),
        history: searched.history,
        notice: searched.notice,
      }),
    );
  }, [targets, query, selectedKey, searched, onSearchStatus]);
  useImperativeHandle(
    controls,
    () => ({
      act(action) {
        const { blocks, expanded, selectedKey, targets, pending } =
          current.current;
        const box = scroll.current;
        if (!box) return;
        switch (action.type) {
          case "copy.start": {
            const width = Math.max(1, box.viewport.width - 1);
            const doc = copyDocument(blocks, expanded, width);
            copyLayout.current = { width, first: blocks[0]?.key ?? null };
            const next = startCopy(doc.lines, Math.max(1, box.viewport.height));
            copyRef.current = next;
            setCopy(next);
            if (next.top === 0) void olderRef.current?.().catch(() => {});
            break;
          }
          case "copy.key": {
            const state = copyRef.current;
            if (!state) break;
            const result = copyKey(state, action.key);
            copyRef.current = result.state;
            setCopy(result.state);
            // At the top of what is loaded: page older history in above it.
            if (result.state.top === 0)
              void olderRef.current?.().catch(() => {});
            if (result.effect.kind === "file") {
              const { text, col } = result.effect;
              const link =
                resolverRef.current?.resolveAt(
                  text,
                  Array.from(text).slice(0, col).join("").length,
                ) ?? null;
              if (link) {
                openRef.current(link);
                onCopyRef.current({ kind: "exit" });
              } else files?.notify("No file path or link under the cursor");
            } else if (result.effect.kind !== "none")
              onCopyRef.current(result.effect);
            break;
          }
          case "hint.start": {
            const targets = resolverRef.current
              ? assignHints(visibleSpots(renderer, box, resolverRef.current))
              : [];
            if (targets.length) setHint({ targets, typed: "" });
            else {
              files?.notify("No file paths or links on screen");
              onHintDoneRef.current();
            }
            break;
          }
          case "hint.key": {
            const state = hintRef.current;
            if (!state) break;
            const result = hintKey(state, action.key);
            hintRef.current = result.state;
            setHint(result.state);
            if (result.effect.kind === "open")
              openRef.current(result.effect.value);
            if (result.effect.kind !== "none") {
              setHint(null);
              onHintDoneRef.current();
            }
            break;
          }
          case "search.start":
            draft.current = "";
            break;
          case "search.update":
            draft.current = action.query;
            break;
          case "search.cancel":
            draft.current = "";
            break;
          case "search.commit": {
            setQuery(draft.current);
            historySearch.run(draft.current);
            const found = findMatches(blocks, draft.current);
            const start = blocks.findIndex((b) => b.key === selectedKey);
            const key =
              blocks
                .slice(Math.max(0, start))
                .find((b) => found.includes(b.key))?.key ?? found[0];
            awaitingHistory.current = key === undefined;
            if (key) jump(key);
            break;
          }
          case "timeline.goto": {
            const target = promptTarget(
              action.seq,
              current.current.owners,
              current.current.epoch,
              action.epoch,
            );
            if (target.kind === "stale")
              reveals.notify("History changed; reopen the prompt list");
            else go(target);
            break;
          }
          case "search.next":
            go(
              nextTarget(
                targets,
                targetIndex(targets, selectedKey, pending),
                action.dir,
              ),
            );
            break;
          case "scroll.lines":
            box.scrollBy(action.delta);
            break;
          case "scroll.page":
            box.scrollBy(action.dir * box.viewport.height);
            break;
          case "scroll.half":
            box.scrollBy(
              action.dir * Math.max(1, Math.floor(box.viewport.height / 2)),
            );
            break;
          case "scroll.edge":
            box.scrollTo(action.edge === "top" ? 0 : Infinity);
            break;
          case "block.move": {
            const candidates = blocks.filter(isExpandable);
            const index = candidates.findIndex((b) => b.key === selectedKey);
            const next =
              candidates[
                Math.max(
                  0,
                  Math.min(
                    candidates.length - 1,
                    index < 0
                      ? action.delta > 0
                        ? 0
                        : candidates.length - 1
                      : index + action.delta,
                  ),
                )
              ];
            if (next) {
              selectCurrent(next.key);
              box.scrollChildIntoView(next.key);
            }
            break;
          }
          case "block.toggle":
            if (selectedKey) expandCurrent(toggle(expanded, selectedKey));
            break;
          case "block.expandAll":
          case "block.collapseAll":
            expandCurrent(setAll(blocks, action.type === "block.expandAll"));
            break;
          case "block.toggleAll":
            expandCurrent(
              setAll(
                blocks,
                blocks.some((b) => isExpandable(b) && !expanded.has(b.key)),
              ),
            );
            break;
        }
      },
    }),
    [
      expandCurrent,
      selectCurrent,
      files,
      renderer,
      historySearch,
      reveals,
      jump,
      go,
    ],
  );
  const linkify = useMemo(
    () =>
      resolver
        ? (text: string) => linkifyMarkdown(text, agent.cwd, resolver.isFile)
        : null,
    [resolver, agent.cwd],
  );
  const origin = root.current;
  const modeLabel = agent.availableModes.find(
    (mode) => mode.id === agent.currentModeId,
  )?.label;
  return (
    <box ref={root} flexDirection="column" flexGrow={1} minHeight={1}>
      <text
        fg={foregroundProp(
          paneFocused ? context.theme.accent : context.theme.faint,
        )}
        wrapMode="none"
        flexShrink={0}
      >
        <strong>{agentName(agent)}</strong>{" "}
        {snapshot.turn.kind === "stopping" ? (
          <span fg={foregroundProp(context.theme.warn)}>■ stopping</span>
        ) : snapshot.turn.kind === "running" ||
          agent.status === "initializing" ? (
          <WorkingIndicator />
        ) : null}{" "}
        {agent.provider}
        {agent.model ? `/${agent.model}` : ""}
        {modeLabel ? ` · ${modeLabel}` : ""} · {agent.status} ·{" "}
        {shortPath(agent.cwd)}
      </text>
      {snapshot.status === "loading" ? (
        <text fg={foregroundProp(context.theme.fg)}>Loading history…</text>
      ) : null}
      {snapshot.status === "error" ? (
        <text fg={foregroundProp(context.theme.fg)}>
          Timeline error: {snapshot.error}. Press Enter on the agent to reopen.
        </text>
      ) : null}
      {snapshot.lastActionError ? (
        <text fg={foregroundProp(context.theme.error)}>
          {snapshot.lastActionError}
        </text>
      ) : null}
      {snapshot.lastNotice ? (
        <text fg={foregroundProp(context.theme.muted)}>
          {snapshot.lastNotice}
        </text>
      ) : null}
      {copy ? (
        <CopyView
          state={copy}
          onScroll={(lines) => {
            const state = copyRef.current;
            if (!state) return;
            const next = scrollCopy(state, lines);
            copyRef.current = next;
            setCopy(next);
            if (next.top === 0) void olderRef.current?.().catch(() => {});
          }}
        />
      ) : null}
      <scrollbox
        visible={!copy}
        scrollbarOptions={scrollbarOptions(context.theme)}
        ref={scroll}
        flexGrow={1}
        minHeight={1}
        stickyScroll
        stickyStart="bottom"
        focused={focused}
        scrollX={false}
      >
        {blocks.map((block, i) => (
          <box
            id={block.key}
            key={block.key}
            flexDirection="row"
            marginBottom={1}
            flexShrink={0}
            onMouseDown={(event) => {
              if (openAt(event.x, event.y)) event.stopPropagation();
            }}
          >
            <text fg={foregroundProp(context.theme.fg)} width={1}>
              {selectedKey === block.key ? "▌" : " "}
            </text>
            <box flexGrow={1} minWidth={0} flexDirection="column">
              <BlockBody
                block={block}
                expanded={expanded.has(block.key)}
                streaming={
                  i === blocks.length - 1 &&
                  (snapshot.turn.kind === "running" ||
                    snapshot.turn.kind === "stopping")
                }
                linkify={linkify}
                onToggle={(event) => {
                  if (resolver && linkAt(renderer, resolver, event)) return;
                  selectCurrent(block.key);
                  expandCurrent(toggle(current.current.expanded, block.key));
                }}
              />
            </box>
          </box>
        ))}
        {snapshot.turn.kind === "running" ? (
          <text
            id={`timeline-working:${agent.id}`}
            height={1}
            flexShrink={0}
            fg={foregroundProp(context.theme.muted)}
          >
            <WorkingIndicator
              key={snapshot.turn.turnId ?? "running"}
              showElapsed
              startedAt={
                agent.activeTurn?.startedAt &&
                agent.activeTurn.turnId === snapshot.turn.turnId
                  ? Date.parse(agent.activeTurn.startedAt)
                  : undefined
              }
            />
          </text>
        ) : null}
      </scrollbox>
      {hint && origin
        ? hint.targets
            .filter((target) => target.label.startsWith(hint.typed))
            .map((target) => (
              <text
                key={`hint:${target.row}:${target.col}`}
                id={`file-hint:${target.label}`}
                position="absolute"
                left={Math.max(0, target.col - origin.x - target.label.length)}
                top={target.row - origin.y}
                height={1}
                wrapMode="none"
                bg={backgroundProp(context.theme.accent)}
                fg={foregroundProp(context.theme.cursorFg)}
                attributes={
                  context.theme.accent
                    ? TextAttributes.BOLD
                    : TextAttributes.BOLD | TextAttributes.INVERSE
                }
              >
                {target.label}
              </text>
            ))
        : null}
    </box>
  );
}
const NO_VERIFIER: Pick<PathVerifier, "subscribe" | "getSnapshot"> = {
  subscribe: () => () => {},
  getSnapshot: () => 0,
};
/** The last drawn frame as text rows (what the user sees). */
function screenRows(renderer: CliRenderer): string[] {
  return new TextDecoder()
    .decode(renderer.currentRenderBuffer.getRealCharBytes(true))
    .split("\n");
}
function linkAt(
  renderer: CliRenderer,
  resolver: FileResolver,
  point: { x: number; y: number },
): boolean {
  const row = screenRows(renderer)[point.y];
  if (row === undefined) return false;
  return (
    resolver.resolveAt(
      row,
      Array.from(row).slice(0, point.x).join("").length,
    ) !== null
  );
}
function visibleSpots(
  renderer: CliRenderer,
  box: ScrollBoxRenderable,
  resolver: FileResolver,
) {
  const width = box.viewport.width;
  const rows = screenRows(renderer)
    .slice(box.y, box.y + box.viewport.height)
    .map((row) =>
      Array.from(row)
        .slice(box.x, box.x + width)
        .join(""),
    );
  return screenSpots(rows, { x: box.x, y: box.y }, (text) =>
    // A link label and its URL drawn beside it share one hint.
    resolver.linksIn(text).map((span) => ({
      start: span.start,
      raw: span.link.kind === "url" ? span.link.url : span.raw,
      value: span.link,
    })),
  );
}
