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
import {
  type CommandItem,
  type CommandRegistry,
  rankCommands,
} from "./registry.js";
import { back, push, type StackEntry } from "./steps.js";
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
  const [stack, setStack] = useState<StackEntry[]>([]);
  const stackRef = useRef(stack);
  const [root, setRoot] = useState({ query: "", selected: 0 });
  const rootRef = useRef(root);
  const entry = stack.at(-1);
  const step = entry?.step;
  const query = entry?.query ?? root.query;
  const selected = entry?.selected ?? root.selected;
  const [choices, setChoices] = useState<
    | { kind: "loading" }
    | { kind: "ready"; items: readonly CommandItem[] }
    | { kind: "error"; message: string }
  >({ kind: "ready", items: [] });
  useEffect(() => {
    if (step?.kind !== "choice") return;
    let active = true;
    setChoices({ kind: "loading" });
    Promise.resolve()
      .then(() => step.items())
      .then(
        (items) => {
          if (active) setChoices({ kind: "ready", items });
        },
        (error: unknown) => {
          if (active)
            setChoices({
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      active = false;
    };
  }, [step]);
  const results = rankCommands(
    step
      ? step.kind === "choice" && choices.kind === "ready"
        ? choices.items
        : []
      : registry.items(),
    query,
  );
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const selection = useRef(index);
  selection.current = index;
  function change(query: string, selected: number) {
    const current = stackRef.current;
    const last = current.at(-1);
    if (last) {
      const next = [...current.slice(0, -1), { ...last, query, selected }];
      stackRef.current = next;
      setStack(next);
    } else {
      rootRef.current = { query, selected };
      setRoot(rootRef.current);
    }
    selection.current = selected;
  }
  function proceed(next: ReturnType<CommandItem["run"]>) {
    if (!next) {
      onClose();
      return;
    }
    if (next === stackRef.current.at(-1)?.step) return;
    const entries = push(stackRef.current, next);
    stackRef.current = entries;
    setStack(entries);
    selection.current = 0;
    setChoices({ kind: "loading" });
  }
  function goBack() {
    const current = stackRef.current;
    if (!current.length) {
      onClose();
      return;
    }
    const next = back(current) ?? [];
    stackRef.current = next;
    setStack(next);
  }
  const boxWidth = Math.max(1, Math.floor(width * 0.6));
  const boxHeight = Math.min(20, height);
  const capacity = Math.max(1, Math.floor((boxHeight - 4) / 3));
  const start = Math.max(0, index - capacity + 1);
  function run(at: number) {
    const row = results[at];
    if (!row) return;
    proceed(row.item.run());
  }
  useKeyboard((event) => {
    const movement =
      event.name === "down" || (event.ctrl && event.name === "n")
        ? 1
        : event.name === "up" || (event.ctrl && event.name === "p")
          ? -1
          : 0;
    if (step?.kind === "confirm") {
      if (["y", "n", "escape"].includes(event.name)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.name === "y") {
          step.confirm();
          onClose();
        } else goBack();
      }
      return;
    }
    if (event.name === "escape" || event.name === "return" || movement) {
      event.preventDefault();
      event.stopPropagation();
      if (event.name === "escape") goBack();
      else if (event.name === "return") {
        if (step?.kind === "input")
          proceed(step.submit(stackRef.current.at(-1)?.query ?? ""));
        else run(selection.current);
      } else {
        selection.current = Math.max(
          0,
          Math.min(results.length - 1, selection.current + movement),
        );
        change(
          stackRef.current.at(-1)?.query ?? rootRef.current.query,
          selection.current,
        );
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
          {stack.map((entry) => ` › ${entry.step.title}`).join("")}
        </text>
        {step?.kind === "confirm" ? (
          <box
            id="command:confirm"
            onMouseDown={(event) => {
              event.stopPropagation();
              step.confirm();
              onClose();
            }}
          >
            <text fg={foregroundProp(theme.fg)}>
              Confirm · y confirm · n/Esc back
            </text>
          </box>
        ) : (
          <input
            key={stack.length}
            textColor={foregroundProp(theme.fg)}
            focusedTextColor={foregroundProp(theme.fg)}
            backgroundColor={backgroundProp(theme.codeBg)}
            focusedBackgroundColor={backgroundProp(theme.codeBg)}
            placeholderColor={foregroundProp(theme.muted)}
            focused
            placeholder={
              step?.kind === "input" ? step.placeholder : "Search commands…"
            }
            value={query}
            onInput={(value) => {
              change(value, 0);
            }}
          />
        )}
        {step?.kind === "choice" && choices.kind === "loading" ? (
          <text fg={foregroundProp(theme.muted)}>Loading…</text>
        ) : null}
        {step?.kind === "choice" && choices.kind === "error" ? (
          <text fg={foregroundProp(theme.error)}>! {choices.message}</text>
        ) : null}
        {(!step || (step.kind === "choice" && choices.kind === "ready")) &&
        results.length === 0 ? (
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
