import { extname } from "node:path";
import type { PaseoAgent } from "@getpaseo/client";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
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
import type { TimelineStore } from "../App.js";
import { agentName, shortPath } from "../agent-display.js";
import type { Action } from "../input/keymap.js";
import { Markdown } from "../render/markdown.js";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import { useStore } from "../use-store.js";
import { type Block, toBlocks } from "./blocks.js";
import { setAll, toggle } from "./expansion.js";
import { findMatches, nextMatch } from "./search.js";

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
function summary(detail: ToolCallDetail): string {
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    case "search":
      return detail.query;
    case "fetch":
      return detail.url;
    case "sub_agent":
      return detail.description ?? detail.subAgentType ?? "";
    case "plan":
      return detail.text;
    case "plain_text":
      return detail.text ?? detail.label ?? "";
    default:
      return "";
  }
}
function BlockBody({
  block,
  expanded,
  streaming,
  onToggle,
}: {
  block: Block;
  expanded: boolean;
  streaming: boolean;
  onToggle(): void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  switch (block.kind) {
    case "assistant":
      return <Markdown text={block.text} streaming={streaming} />;
    case "user":
      return (
        <box backgroundColor={backgroundProp(theme.selectionBg)}>
          <text fg={foregroundProp(theme.user)}>
            <strong>› {block.text}</strong>
          </text>
        </box>
      );
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
            {status === "running"
              ? "◌"
              : status === "completed"
                ? "✓"
                : status === "failed"
                  ? "✗"
                  : "·"}{" "}
            {block.call.name} {summary(block.call.detail).replace(/\s+/g, " ")}
          </text>
          {expanded ? <ToolDetail detail={block.call.detail} /> : null}
        </box>
      );
    }
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
export function TimelineView({
  store,
  agent,
  focused,
  controls,
  onSearchStatus,
}: {
  store: TimelineStore;
  agent: PaseoAgent;
  focused: boolean;
  controls: Ref<TimelineControls>;
  onSearchStatus: (status: string) => void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const snapshot = useStore(store);
  const blocks = useMemo(() => toBlocks(snapshot.rows), [snapshot.rows]);
  const scroll = useRef<ScrollBoxRenderable>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedKey, select] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => findMatches(blocks, query), [blocks, query]);
  const current = useRef({
    blocks,
    expanded,
    selectedKey,
    matches,
  });
  current.current = {
    blocks,
    expanded,
    selectedKey,
    matches,
  };
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
  useEffect(() => {
    onSearchStatus(
      query
        ? matches.length
          ? `match ${Math.max(0, matches.indexOf(selectedKey ?? "")) + 1}/${matches.length}`
          : "no match"
        : "",
    );
  }, [matches, query, selectedKey, onSearchStatus]);
  useImperativeHandle(
    controls,
    () => ({
      act(action) {
        const { blocks, expanded, selectedKey, matches } = current.current;
        function jump(key: string | null) {
          if (!key) return;
          selectCurrent(key);
          expandCurrent(new Set(current.current.expanded).add(key));
          scroll.current?.scrollChildIntoView(key);
        }
        const box = scroll.current;
        if (!box) return;
        switch (action.type) {
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
            const found = findMatches(blocks, draft.current);
            const start = blocks.findIndex((b) => b.key === selectedKey);
            jump(
              blocks
                .slice(Math.max(0, start))
                .find((b) => found.includes(b.key))?.key ??
                found[0] ??
                null,
            );
            break;
          }
          case "search.next":
            jump(nextMatch(matches, selectedKey, action.dir));
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
            const candidates = blocks.filter(
              (b) => b.kind === "tool" || b.kind === "reasoning",
            );
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
                blocks.some(
                  (b) =>
                    (b.kind === "tool" || b.kind === "reasoning") &&
                    !expanded.has(b.key),
                ),
              ),
            );
            break;
        }
      },
    }),
    [expandCurrent, selectCurrent],
  );
  return (
    <box flexDirection="column" flexGrow={1} minHeight={1}>
      <text
        fg={foregroundProp(context.theme.fg)}
        wrapMode="none"
        flexShrink={0}
      >
        <strong>{agentName(agent)}</strong> {agent.provider}
        {agent.model ? `/${agent.model}` : ""} · {agent.status} ·{" "}
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
      <scrollbox
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
          >
            <text fg={foregroundProp(context.theme.fg)} width={1}>
              {selectedKey === block.key ? "▌" : " "}
            </text>
            <box flexGrow={1} minWidth={0} flexDirection="column">
              <BlockBody
                block={block}
                expanded={expanded.has(block.key)}
                streaming={
                  i === blocks.length - 1 && snapshot.turn.kind === "running"
                }
                onToggle={() => {
                  selectCurrent(block.key);
                  expandCurrent(toggle(current.current.expanded, block.key));
                }}
              />
            </box>
          </box>
        ))}
      </scrollbox>
    </box>
  );
}
