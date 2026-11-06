import type { PaseoAgent } from "@getpaseo/client";
import {
  type BaseRenderable,
  type BoxRenderable,
  TextareaRenderable,
} from "@opentui/core";
import {
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CompletionPort } from "../../connection/ports.js";
import type { MessageQueue } from "../../state/message-queue.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import type { CopyEffect } from "../copy/copy-mode.js";
import type { Action, Mode, Stroke } from "../input/keymap.js";
import {
  PermissionPrompt,
  permissionLines,
} from "../permission/PermissionPrompt.js";
import {
  type Focus,
  watchPermissions,
} from "../permission/permission-focus.js";
import { permissionHeight as measurePermissionHeight } from "../permission/permission-layout.js";
import { PromptInput } from "../prompt/PromptInput.js";
import { QuestionPrompt } from "../prompt/QuestionPrompt.js";
import { QueuedMessages } from "../prompt/QueuedMessages.js";
import { questionForm } from "../prompt/question-form.js";
import {
  moveSelection,
  queueHint,
  queueRows,
  targetItem,
} from "../prompt/queue-view.js";
import { ThemeContext } from "../render/theme.js";
import { SubagentPill } from "../subagents/SubagentPill.js";
import type { PaneSubagents } from "../subagents/subagent-popup.js";
import {
  type TimelineControls,
  TimelineView,
} from "../timeline/TimelineView.js";
import { useStore } from "../use-store.js";
import { ArchivedCallout } from "./ArchivedCallout.js";
import { agentName } from "./agent-display.js";
import { nextMode } from "./agent-modes.js";
import type { UnarchiveState } from "./archived-views.js";
import { stopText } from "./working-indicator.js";

function textarea(node: BaseRenderable): TextareaRenderable | undefined {
  if (node instanceof TextareaRenderable) return node;
  for (const child of node.getChildren()) {
    const found = textarea(child);
    if (found) return found;
  }
  return undefined;
}
export function AgentPane({
  store,
  agent,
  focused,
  focus,
  mode,
  setFocus,
  setMode,
  controls,
  height,
  prefix,
  onSearchStatus,
  completions,
  editPrompt,
  editRequest = 0,
  subagents = null,
  onOpenSubagents = () => {},
  onCopy,
  unarchive = IDLE,
  onUnarchive = () => {},
  stopShortcut = "Ctrl-X",
  queue,
  shortcut = NO_SHORTCUT,
}: {
  store: TimelineStore;
  agent: PaseoAgent;
  focused: boolean;
  focus: Focus;
  mode: Mode;
  setFocus: (focus: Focus | ((current: Focus) => Focus)) => void;
  setMode: (mode: Mode) => void;
  controls: Ref<TimelineControls>;
  height: number;
  prefix: Stroke;
  onSearchStatus: (status: string) => void;
  completions?: CompletionPort;
  editPrompt?(text: string): Promise<string>;
  /** Incremented to open the external editor on the prompt (Command Center action). */
  editRequest?: number;
  /** Subagent pill above the input; null when the agent has no parent or children. */
  subagents?: PaneSubagents | null;
  onOpenSubagents?(): void;
  onCopy(effect: Exclude<CopyEffect, { kind: "none" }>): void;
  /** An archived agent's unarchive progress; its callout replaces the prompt. */
  unarchive?: UnarchiveState;
  onUnarchive?(): void;
  /** The stop key's label, for the retry hint. */
  stopShortcut?: string;
  /** Messages typed while the turn runs; absent for view-only panes. */
  queue?: MessageQueue;
  /** Labels a key binding from the effective table, for the queue's hints. */
  shortcut?(action: Action): string | null;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const snapshot = useStore(store),
    timeline = useRef<TimelineControls>(null),
    box = useRef<BoxRenderable>(null);
  const archived = agent.archivedAt != null;
  const queued = useStore(queue ?? NO_QUEUE);
  const [selectedId, selectQueued] = useState<string | null>(null);
  /** A multi-line message the remove key was pressed on once. */
  const [confirming, confirmQueued] = useState<string | null>(null);
  /** Read by keys arriving before React renders the last change. */
  const queueState = useRef({ selectedId, confirming });
  function setSelectedId(id: string | null) {
    queueState.current = { ...queueState.current, selectedId: id };
    selectQueued(id);
  }
  function setConfirming(id: string | null) {
    queueState.current = { ...queueState.current, confirming: id };
    confirmQueued(id);
  }
  function queueAction(action: Action) {
    if (!queue) return;
    const { items } = queue.getSnapshot();
    const { selectedId, confirming } = queueState.current;
    const target = targetItem(items, selectedId);
    if (action.type !== "queue.remove") setConfirming(null);
    switch (action.type) {
      case "queue.select":
        setSelectedId(moveSelection(items, selectedId, action.delta));
        return;
      case "queue.clear":
        queue.clear();
        return;
      case "queue.send":
      case "queue.interrupt":
        if (target)
          void queue.sendNow(
            target.id,
            action.type === "queue.send" ? "steer" : "interrupt",
          );
        return;
      case "queue.edit": {
        const input = box.current ? textarea(box.current) : undefined;
        const text = target && input ? queue.take(target.id) : null;
        if (!input || text === null) return;
        const draft = input.plainText;
        const next = draft.trim() ? `${draft}\n${text}` : text;
        input.replaceText(next);
        input.cursorOffset = next.length;
        return;
      }
      case "queue.remove":
        if (!target) return;
        if (target.text.includes("\n") && confirming !== target.id) {
          setConfirming(target.id);
          return;
        }
        setConfirming(null);
        queue.remove(target.id);
        return;
    }
  }
  useEffect(() => {
    if (focused && !archived)
      return watchPermissions(store, (transition) => setFocus(transition));
  }, [store, focused, archived, setFocus]);
  useImperativeHandle(controls, () => ({
    act(action: Action) {
      if (action.type === "agent.cycleMode") {
        const id = nextMode(agent);
        if (id) void store.setMode(id);
        return;
      }
      if (action.type === "stop") {
        void store.stop();
        return;
      }
      if (action.type.startsWith("queue.")) {
        queueAction(action);
        return;
      }
      if (action.type === "prefix.literal") {
        if (box.current) textarea(box.current)?.insertText(prefix.sequence);
        return;
      }
      timeline.current?.act(action);
    },
  }));
  // View-only: an archived agent's pending requests are not offered for an answer.
  const permission = archived
    ? undefined
    : (snapshot.pendingPermissions.find(
        (r) => focus.pane === "permission" && r.id === focus.requestId,
      ) ?? snapshot.pendingPermissions[0]);
  const question = permission ? questionForm(permission) : null;
  const permissionHeight = permission
    ? measurePermissionHeight(
        height,
        permissionLines(permission).length,
        permission.actions?.length ?? 0,
      )
    : 0;
  return (
    <box ref={box} flexDirection="column" flexGrow={1} minHeight={0}>
      <TimelineView
        store={store}
        agent={agent}
        paneFocused={focused}
        focused={focused && focus.pane === "timeline" && mode.kind === "normal"}
        controls={timeline}
        onSearchStatus={onSearchStatus}
        copying={focused && mode.kind === "copy"}
        onCopy={onCopy}
        hinting={focused && mode.kind === "hint"}
        onHintDone={() => setMode({ kind: "normal", pending: "" })}
      />
      {permission && question ? (
        <QuestionPrompt
          key={permission.id}
          request={permission}
          form={question}
          store={store}
          focused={focused && focus.pane === "permission"}
          maxRows={Math.max(4, height - 5)}
        />
      ) : permission ? (
        <PermissionPrompt
          key={permission.id}
          request={permission}
          store={store}
          focused={focused && focus.pane === "permission"}
          height={permissionHeight}
          onDefer={() => setFocus({ pane: "timeline" })}
        />
      ) : null}
      {subagents ? (
        <SubagentPill view={subagents} onOpen={onOpenSubagents} />
      ) : null}
      {!archived && queued.items.length ? (
        <QueuedMessages
          {...queueRows(queued.items, selectedId)}
          hint={queueHint(queued.paused, confirming, shortcut)}
        />
      ) : null}
      {archived ? (
        <ArchivedCallout state={unarchive} onUnarchive={onUnarchive} />
      ) : (
        <PromptInput
          store={store}
          focused={
            focused &&
            (mode.kind === "insert" ||
              (mode.kind === "prefix" && mode.returnTo === "insert")) &&
            focus.pane === "prompt"
          }
          name={agentName(agent)}
          agentId={agent.id}
          cwd={agent.cwd}
          completions={completions}
          editPrompt={editPrompt}
          editRequest={editRequest}
          queue={queue}
          queueKey={shortcut({ type: "queue.send" })}
          onClose={() => {
            setMode({ kind: "normal", pending: "" });
            setFocus((current) =>
              current.pane === "prompt" ? { pane: "timeline" } : current,
            );
          }}
        />
      )}
      {snapshot.turn.kind === "stopping" ? (
        <text height={1}>{stopText(snapshot.turn.phase, stopShortcut)}</text>
      ) : null}
    </box>
  );
}
const IDLE: UnarchiveState = { kind: "idle" };
const NO_QUEUE = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_QUEUE,
};
const EMPTY_QUEUE = { items: [], paused: false };
function NO_SHORTCUT() {
  return null;
}
