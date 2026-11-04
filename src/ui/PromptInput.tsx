import type { TextareaRenderable } from "@opentui/core";
import { useContext, useEffect, useRef, useState } from "react";
import type { TimelineStore } from "./App.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "./render/theme.js";

interface PromptInputProps {
  store: TimelineStore;
  focused: boolean;
  name: string;
  onClose(): void;
}
export function PromptInput({
  store,
  focused,
  name,
  onClose,
}: PromptInputProps) {
  const editor = useRef<TextareaRenderable>(null);
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  useEffect(() => {
    if (!focused && !inFlight.current) editor.current?.clear();
  }, [focused]);
  async function send() {
    const text = editor.current?.plainText ?? "";
    if (!text.trim() || inFlight.current) return;
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
  return (
    <box flexDirection="column" flexShrink={0} height={focused ? 3 : 1}>
      {sending ? <text fg={foregroundProp(theme.fg)}>Sending…</text> : null}
      <textarea
        ref={editor}
        height={focused ? 2 : 1}
        focused={focused && !sending}
        placeholder={`Message ${name}…`}
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
        onSubmit={() => void send()}
      />
    </box>
  );
}
