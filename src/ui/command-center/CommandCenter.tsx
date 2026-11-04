import { TextAttributes } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { Fragment, useContext, useEffect, useRef, useState } from "react";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { type CommandRegistry, rankCommands } from "./registry.js";
export function CommandCenter({
  registry,
  onClose,
}: {
  registry: CommandRegistry;
  onClose(): void;
}) {
  const renderer = useRenderer();
  const [previousFocus] = useState(() => renderer.currentFocusedRenderable);
  useEffect(
    () => () => {
      if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus();
    },
    [previousFocus],
  );
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  const { width, height } = useTerminalDimensions();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = rankCommands(registry.items(), query);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const selection = useRef(index);
  selection.current = index;
  const boxWidth = Math.max(1, Math.floor(width * 0.6));
  const boxHeight = Math.min(20, height);
  const capacity = Math.max(1, Math.floor((boxHeight - 4) / 3));
  const start = Math.max(0, index - capacity + 1);
  function run(at: number) {
    const row = results[at];
    if (!row) return;
    onClose();
    row.item.run();
  }
  useKeyboard((event) => {
    const movement =
      event.name === "down" || (event.ctrl && event.name === "n")
        ? 1
        : event.name === "up" || (event.ctrl && event.name === "p")
          ? -1
          : 0;
    if (event.name === "escape" || event.name === "return" || movement) {
      event.preventDefault();
      event.stopPropagation();
      if (event.name === "escape") onClose();
      else if (event.name === "return") run(selection.current);
      else {
        selection.current = Math.max(
          0,
          Math.min(results.length - 1, selection.current + movement),
        );
        setSelected(selection.current);
      }
    }
  });
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      zIndex={20}
      onMouseDown={onClose}
    >
      <box
        position="absolute"
        left={Math.floor((width - boxWidth) / 2)}
        top={Math.max(0, Math.floor((height - boxHeight) / 2))}
        width={boxWidth}
        height={boxHeight}
        border
        borderColor={foregroundProp(theme.borderFocused)}
        backgroundColor={backgroundProp(theme.codeBg)}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <text fg={foregroundProp(theme.fg)} height={1}>
          Command Center
        </text>
        <input
          textColor={foregroundProp(theme.fg)}
          focusedTextColor={foregroundProp(theme.fg)}
          backgroundColor={backgroundProp(theme.codeBg)}
          focusedBackgroundColor={backgroundProp(theme.codeBg)}
          placeholderColor={foregroundProp(theme.muted)}
          focused
          placeholder="Search commands…"
          value={query}
          onInput={(value) => {
            setQuery(value);
            selection.current = 0;
            setSelected(0);
          }}
        />
        {results.length === 0 ? (
          <text fg={foregroundProp(theme.muted)}>No commands match</text>
        ) : null}
        {results.slice(start, start + capacity).map((row, offset) => {
          const at = start + offset;
          return (
            <box key={row.item.id} flexShrink={0} flexDirection="column">
              {at === start || results[at - 1].item.group !== row.item.group ? (
                <text height={1} fg={foregroundProp(theme.muted)}>
                  {row.item.group}
                </text>
              ) : null}
              <box
                id={`command:${row.item.id}`}
                height={2}
                flexDirection="column"
                backgroundColor={backgroundProp(
                  at === index ? theme.selectionBg : theme.codeBg,
                )}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  run(at);
                }}
              >
                <box flexDirection="row" height={1}>
                  <text
                    fg={foregroundProp(theme.fg)}
                    flexGrow={1}
                    height={1}
                    wrapMode="none"
                  >
                    {row.titleRanges.map((range, index) => (
                      <Fragment key={`${row.item.id}:${range.start}`}>
                        <span>
                          {row.item.title.slice(
                            index === 0
                              ? 0
                              : row.titleRanges[index - 1].start +
                                  row.titleRanges[index - 1].length,
                            range.start,
                          )}
                        </span>
                        <span
                          fg={foregroundProp(theme.accent)}
                          attributes={TextAttributes.BOLD}
                        >
                          {row.item.title.slice(
                            range.start,
                            range.start + range.length,
                          )}
                        </span>
                      </Fragment>
                    ))}
                    {row.item.title.slice(
                      row.titleRanges.length
                        ? (row.titleRanges.at(-1)?.start ?? 0) +
                            (row.titleRanges.at(-1)?.length ?? 0)
                        : 0,
                    )}
                  </text>
                  <text height={1} fg={foregroundProp(theme.faint)}>
                    {row.item.shortcut ?? ""}
                  </text>
                </box>
                <text
                  height={1}
                  fg={foregroundProp(theme.muted)}
                  wrapMode="none"
                >
                  {row.item.subtitle ?? ""}
                </text>
              </box>
            </box>
          );
        })}
      </box>
    </box>
  );
}
