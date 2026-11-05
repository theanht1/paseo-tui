import type { PaseoTerminalHandle } from "@getpaseo/client";
import { extend, useKeyboard } from "@opentui/react";
import { useContext, useEffect, useMemo, useRef } from "react";
import type { TerminalStreamPort } from "../../connection/ports.js";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import { useStore } from "../use-store.js";
import { createTerminalStore } from "./terminal-store.js";
import { TerminalSurfaceRenderable } from "./terminal-surface.js";

declare module "@opentui/react" {
  interface OpenTUIComponents {
    terminalSurface: typeof TerminalSurfaceRenderable;
  }
}
extend({ terminalSurface: TerminalSurfaceRenderable });

export function TerminalPane({
  terminal,
  stream,
  focused,
  paneFocused,
  onFocus,
}: {
  terminal: PaseoTerminalHandle;
  stream: TerminalStreamPort;
  focused: boolean;
  paneFocused: boolean;
  onFocus(): void;
}) {
  const surface = useRef<TerminalSurfaceRenderable>(null);
  const store = useMemo(
    () => createTerminalStore(terminal.id, stream),
    [terminal.id, stream],
  );
  useEffect(() => {
    if (surface.current) store.start(surface.current);
    return () => store.close();
  }, [store]);
  useEffect(() => {
    if (focused) surface.current?.focus();
    else surface.current?.blur();
  }, [focused]);
  const state = useStore(store);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  useKeyboard((event) => {
    if (!focused || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (!(event.ctrl && event.name === "]"))
      surface.current?.handleKeyPress(event);
  });
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      border
      title="Terminal"
      borderColor={foregroundProp(paneFocused ? theme.accent : theme.faint)}
      onMouseDown={onFocus}
    >
      <terminalSurface
        id="terminal-surface"
        ref={surface}
        width="100%"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        onMouseDown={() => {
          if (!focused) surface.current?.blur();
        }}
        onData={(data, source) => {
          if (source === "response" || focused)
            store.write(new TextDecoder().decode(data));
        }}
        onTerminalResize={store.resize}
      />
      <text
        flexShrink={0}
        fg={foregroundProp(state.error ? theme.error : theme.muted)}
      >
        {state.error ??
          (focused
            ? "Terminal input · Ctrl-] normal mode"
            : "i to type in terminal · gt/gT tabs")}
      </text>
    </box>
  );
}
