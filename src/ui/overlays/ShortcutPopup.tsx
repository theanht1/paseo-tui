import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { Fragment, useContext, useMemo } from "react";
import { useKeyOwner } from "../input/key-router.js";
import { type Binding, helpRows } from "../input/keymap.js";
import {
  backgroundProp,
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import { useStore } from "../use-store.js";
import { popupRect } from "./popup-layout.js";
import { createShortcutSearch, filterShortcuts } from "./shortcut-search.js";
export function ShortcutPopup({
  prefix,
  bindings,
  onClose,
}: {
  prefix: string;
  bindings?: readonly Binding[];
  onClose(): void;
}) {
  const { width, height } = useTerminalDimensions();
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const search = useMemo(() => createShortcutSearch(), []);
  const state = useStore(search);
  useKeyOwner(
    state.focus === "search",
    (event) =>
      event.ctrl && event.name === "c" && search.key(event) === "handled",
  );
  useKeyboard((event) => {
    const result = search.key(event);
    if (result !== "pass") {
      event.preventDefault();
      event.stopPropagation();
      if (result === "close") onClose();
    }
  });
  const rows = filterShortcuts(helpRows(prefix, bindings), state.query);
  const sections = [...new Set(rows.map((row) => row.section))];
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height - 1}
      zIndex={15}
      onMouseDown={onClose}
    >
      <box
        id="shortcut-modal"
        position="absolute"
        {...popupRect(
          width,
          height - 1,
          Math.max(88, Math.floor(width * 0.8)),
          Math.max(Math.min(28, height - 3), Math.ceil(height * 0.8)),
        )}
        border
        borderColor={foregroundProp(theme.accent)}
        backgroundColor={backgroundProp(theme.codeBg)}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <box height={1} flexDirection="row">
          <text fg={foregroundProp(theme.accent)} flexGrow={1}>
            <strong>Keyboard shortcuts</strong>
          </text>
          <text
            id="shortcuts-close"
            fg={foregroundProp(theme.muted)}
            onMouseDown={onClose}
          >
            {" "}
            ×{" "}
          </text>
        </box>
        <input
          id="shortcut-search"
          value={state.query}
          onInput={search.change}
          focused={state.focus === "search"}
          onMouseDown={() => search.focus("search")}
          placeholder="Search keys, descriptions, sections…"
          textColor={foregroundProp(theme.fg)}
          focusedTextColor={foregroundProp(theme.fg)}
          backgroundColor={backgroundProp(theme.codeBg)}
          focusedBackgroundColor={backgroundProp(theme.codeBg)}
        />
        <scrollbox
          focused={state.focus === "results"}
          onMouseDown={() => search.focus("results")}
          flexGrow={1}
          scrollX={false}
          scrollbarOptions={scrollbarOptions(theme)}
        >
          {sections.map((section) => (
            <Fragment key={section}>
              <text fg={foregroundProp(theme.accent)}>
                <strong>{section === "any" ? "General" : section}</strong>
              </text>
              {rows
                .filter((row) => row.section === section)
                .map((row) => (
                  <text
                    key={row.keys}
                    wrapMode="none"
                    fg={foregroundProp(theme.muted)}
                  >
                    {" "}
                    <span
                      fg={foregroundProp(theme.accent)}
                      bg={backgroundProp(theme.selectionBg)}
                      attributes={1}
                    >
                      {" "}
                      {row.keys}{" "}
                    </span>{" "}
                    {row.description}
                  </text>
                ))}
            </Fragment>
          ))}
          {rows.length === 0 ? (
            <text fg={foregroundProp(theme.muted)}>No shortcuts match</text>
          ) : null}
          {!state.query ? (
            <text fg={foregroundProp(theme.muted)}>
              Permission: 1–9 choose · y allow / n deny · m message · Esc defer
            </text>
          ) : null}
          {!state.query ? (
            <text fg={foregroundProp(theme.muted)}>
              Insert: Enter send · Shift-Enter / Ctrl-J newline · / commands · @
              files · Ctrl-G editor · Ctrl-C leave
            </text>
          ) : null}
        </scrollbox>
        <text fg={foregroundProp(theme.muted)}>
          Esc clear/close · Tab search/results · q closes empty results
        </text>
      </box>
    </box>
  );
}
