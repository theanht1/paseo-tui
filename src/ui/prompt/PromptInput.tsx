import type { TextareaRenderable } from "@opentui/core";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CompletionPort } from "../../connection/ports.js";
import type { MessageQueue } from "../../state/message-queue.js";
import type { TimelineStore } from "../../state/timeline-store.js";
import { useKeyOwner } from "../input/key-router.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { useStore } from "../use-store.js";
import {
  CLOSED_COMPLETIONS,
  createCompletionStore,
} from "./prompt-completion.js";

const VISIBLE_ITEMS = 8;

interface PromptInputProps {
  store: TimelineStore;
  focused: boolean;
  name: string;
  agentId: string;
  cwd: string;
  completions?: CompletionPort;
  editPrompt?(text: string): Promise<string>;
  editRequest?: number;
  /** Takes what is sent while a turn runs; without it, Enter always sends. */
  queue?: MessageQueue | undefined;
  /** The send-now key's label, for the placeholder while a turn runs. */
  queueKey?: string | null;
  onClose(): void;
}
export function PromptInput({
  store,
  focused,
  name,
  agentId,
  cwd,
  completions,
  editPrompt,
  editRequest = 0,
  queue,
  queueKey = null,
  onClose,
}: PromptInputProps) {
  const editor = useRef<TextareaRenderable>(null);
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const completion = useMemo(
    () =>
      completions
        ? createCompletionStore(completions, {
            source: { kind: "agent", agentId },
            cwd,
          })
        : null,
    [completions, agentId, cwd],
  );
  useEffect(() => () => completion?.close(), [completion]);
  const popup = useStore(completion ?? CLOSED_COMPLETIONS);
  function sync() {
    const current = editor.current;
    if (current && completion)
      completion.update(current.plainText, current.cursorOffset);
  }
  function replace(text: string, cursor: number) {
    const current = editor.current;
    if (!current) return;
    current.replaceText(text);
    current.cursorOffset = cursor;
    sync();
  }
  function accept(index?: number) {
    const result = completion?.accept(index);
    if (result) replace(result.text, result.cursor);
  }
  async function openEditor() {
    const current = editor.current;
    if (!current || !editPrompt || inFlight.current) return;
    setEditing(true);
    try {
      const text = await editPrompt(current.plainText);
      replace(text, text.length);
    } finally {
      setEditing(false);
    }
  }
  const handledEdit = useRef(editRequest);
  const openEditorRef = useRef(openEditor);
  openEditorRef.current = openEditor;
  useEffect(() => {
    if (!focused || editRequest <= handledEdit.current) return;
    handledEdit.current = editRequest;
    void openEditorRef.current();
  }, [focused, editRequest]);
  useKeyOwner(focused && !sending, (key) => {
    if (key.ctrl && key.name === "g" && editPrompt) {
      void openEditor();
      return true;
    }
    if (popup.kind !== "open" || !completion) return false;
    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      completion.move(1);
      return true;
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      completion.move(-1);
      return true;
    }
    if (key.name === "escape") {
      completion.dismiss();
      return true;
    }
    if (
      (key.name === "tab" || key.name === "return") &&
      !key.shift &&
      popup.items.length
    ) {
      accept();
      return true;
    }
    return false;
  });
  const turn = useStore(store).turn.kind;
  const busy = turn === "running" || turn === "stopping";
  async function send() {
    const text = editor.current?.plainText ?? "";
    if (inFlight.current) return;
    const waiting = queue?.getSnapshot();
    if (!text.trim()) {
      if (waiting?.paused && waiting.items.length) void queue?.resume();
      return;
    }
    const kind = store.getSnapshot().turn.kind;
    if (queue && (kind === "running" || kind === "stopping")) {
      // The turn is busy: hold the message, and stay in the prompt for the next one.
      queue.enqueue(text);
      editor.current?.clear();
      return;
    }
    inFlight.current = true;
    setSending(true);
    await store.send(text);
    inFlight.current = false;
    setSending(false);
    if (!store.getSnapshot().lastActionError) {
      editor.current?.clear();
      onClose();
    }
  }
  const open = focused && popup.kind === "open" ? popup : null;
  const first = open
    ? Math.max(
        0,
        Math.min(
          open.index - VISIBLE_ITEMS + 1,
          open.items.length - VISIBLE_ITEMS,
        ),
      )
    : 0;
  const shown = open ? open.items.slice(first, first + VISIBLE_ITEMS) : [];
  const status = open
    ? open.error
      ? `! ${open.error}`
      : open.items.length
        ? null
        : open.loading
          ? "Loading…"
          : open.trigger.kind === "slash"
            ? "No matching commands"
            : "No matching files"
    : null;
  const popupHeight = open ? shown.length + (status ? 1 : 0) + 2 : 0;
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      height={(focused ? 3 : 1) + popupHeight}
    >
      {open ? (
        <box
          id="prompt-completions"
          height={popupHeight}
          flexShrink={0}
          flexDirection="column"
          border
          borderColor={foregroundProp(theme.accent)}
          backgroundColor={backgroundProp(theme.codeBg)}
          title={
            open.trigger.kind === "slash"
              ? "Commands · ↑↓ Tab/Enter Esc"
              : "Files · ↑↓ Tab/Enter Esc"
          }
        >
          {shown.map((item, offset) => {
            const index = first + offset;
            const selected = index === open.index;
            return (
              <text
                key={item.value}
                id={`completion:${index}`}
                height={1}
                wrapMode="none"
                fg={foregroundProp(selected ? theme.accent : theme.fg)}
                bg={backgroundProp(selected ? theme.selectionBg : theme.codeBg)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  accept(index);
                }}
              >
                {selected ? "› " : "  "}
                {item.label}
                {item.detail ? (
                  <span fg={foregroundProp(theme.muted)}>
                    {`  ${item.detail}`}
                  </span>
                ) : null}
              </text>
            );
          })}
          {status ? (
            <text
              height={1}
              fg={foregroundProp(open.error ? theme.error : theme.muted)}
            >
              {status}
            </text>
          ) : null}
        </box>
      ) : null}
      {sending ? <text fg={foregroundProp(theme.fg)}>Sending…</text> : null}
      {editing ? (
        <text fg={foregroundProp(theme.muted)}>
          Editing in external editor…
        </text>
      ) : null}
      <textarea
        ref={editor}
        height={focused ? 2 : 1}
        focused={focused && !sending && !editing}
        placeholder={
          focused && busy && queue
            ? `Message ${name}…  (Enter queues${queueKey ? ` · ${queueKey} send now` : ""})`
            : focused
              ? `Message ${name}…  (/ commands · @ files · Ctrl-G editor)`
              : `Press i or a to message ${name}…  (/ commands · @ files · Ctrl-G editor)`
        }
        textColor={foregroundProp(theme.fg)}
        focusedTextColor={foregroundProp(theme.fg)}
        focusedBackgroundColor={backgroundProp(theme.codeBg)}
        placeholderColor={foregroundProp(theme.muted)}
        backgroundColor={backgroundProp(theme.codeBg)}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "return", shift: true, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
        ]}
        onContentChange={sync}
        onCursorChange={sync}
        onSubmit={() => void send()}
      />
    </box>
  );
}
