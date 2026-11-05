import { TextAttributes } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CompletionPort } from "../../connection/ports.js";
import { useKeyOwner } from "../input/key-router.js";
import {
  CLOSED_COMPLETIONS,
  createCompletionStore,
} from "../prompt/prompt-completion.js";
import {
  backgroundProp,
  foregroundProp,
  ThemeContext,
} from "../render/theme.js";
import { useStore } from "../use-store.js";
import {
  type CommandItem,
  type CommandRegistry,
  type CommandStep,
  rankCommands,
} from "./registry.js";
import { back, breadcrumb, push, type StackEntry } from "./steps.js";
export function CommandCenter({
  registry,
  initialStep,
  title = "Command Center",
  completions,
  onClose,
}: {
  registry: CommandRegistry;
  initialStep?: CommandStep;
  title?: string;
  /** Serves `/` and `@` suggestions for input steps that ask for them. */
  completions?: CompletionPort;
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
  const [stack, setStack] = useState<StackEntry[]>(() =>
    initialStep ? push([], initialStep) : [],
  );
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
  const candidates = step
    ? step.kind === "choice" && choices.kind === "ready"
      ? choices.items
      : []
    : registry.items();
  const results = rankCommands(candidates, query);
  const completion = useMemo(
    () =>
      step?.kind === "input" && step.completion && completions
        ? createCompletionStore(completions, step.completion)
        : null,
    [step, completions],
  );
  useEffect(() => () => completion?.close(), [completion]);
  const popup = useStore(completion ?? CLOSED_COMPLETIONS);
  function setInput(value: string) {
    change(value, 0);
    completion?.update(value, value.length);
  }
  function acceptCompletion(index?: number) {
    const result = completion?.accept(index);
    if (result) setInput(result.text);
  }
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
    if (!current.length || (initialStep && current.length === 1)) {
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
    const latest = stackRef.current.at(-1)?.query ?? rootRef.current.query;
    const row = (latest === query ? results : rankCommands(candidates, latest))[
      at
    ];
    if (!row) return;
    proceed(row.item.run());
  }
  function submitInput() {
    if (step?.kind === "input")
      proceed(step.submit(stackRef.current.at(-1)?.query ?? ""));
  }
  useKeyOwner(true, (stroke) => {
    if (completion && popup.kind === "open") {
      if (stroke.name === "down" || (stroke.ctrl && stroke.name === "n")) {
        completion.move(1);
        return true;
      }
      if (stroke.name === "up" || (stroke.ctrl && stroke.name === "p")) {
        completion.move(-1);
        return true;
      }
      if (stroke.name === "escape") {
        completion.dismiss();
        return true;
      }
      if (
        (stroke.name === "tab" || stroke.name === "return") &&
        popup.items.length
      ) {
        acceptCompletion();
        return true;
      }
    }
    const movement =
      stroke.name === "down" || (stroke.ctrl && stroke.name === "n")
        ? 1
        : stroke.name === "up" || (stroke.ctrl && stroke.name === "p")
          ? -1
          : 0;
    if (step?.kind === "confirm") {
      if (!["y", "n", "escape"].includes(stroke.name)) return false;
      if (stroke.name === "y") {
        step.confirm();
        onClose();
      } else goBack();
      return true;
    }
    if (stroke.name === "escape") goBack();
    else if (stroke.name === "return") {
      if (step?.kind === "input") submitInput();
      else run(selection.current);
    } else if (movement) {
      selection.current = Math.max(
        0,
        Math.min(results.length - 1, selection.current + movement),
      );
      change(
        stackRef.current.at(-1)?.query ?? rootRef.current.query,
        selection.current,
      );
    } else return false;
    return true;
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
          {breadcrumb(
            title,
            stack.map((entry) => entry.step.title),
            boxWidth - 2,
          )}
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
            onInput={setInput}
          />
        )}
        {popup.kind === "open" ? (
          <box
            id="command:completions"
            flexDirection="column"
            flexShrink={0}
            border
            borderColor={foregroundProp(theme.accent)}
            title={
              popup.trigger.kind === "slash"
                ? "Commands · ↑↓ Tab/Enter Esc"
                : "Files · ↑↓ Tab/Enter Esc"
            }
          >
            {popup.items.length === 0 ? (
              <text height={1} fg={foregroundProp(theme.muted)}>
                {popup.error
                  ? `! ${popup.error}`
                  : popup.loading
                    ? "Loading…"
                    : "No matches"}
              </text>
            ) : null}
            {popup.items.slice(0, 6).map((item, index) => (
              <text
                key={item.value}
                id={`command:completion:${index}`}
                height={1}
                wrapMode="none"
                fg={foregroundProp(
                  index === popup.index ? theme.accent : theme.fg,
                )}
                bg={backgroundProp(
                  index === popup.index ? theme.selectionBg : theme.codeBg,
                )}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  acceptCompletion(index);
                }}
              >
                {index === popup.index ? "› " : "  "}
                {item.label}
                {item.detail ? (
                  <span fg={foregroundProp(theme.muted)}>
                    {`  ${item.detail}`}
                  </span>
                ) : null}
              </text>
            ))}
          </box>
        ) : null}
        {step?.kind === "input" ? (
          <text
            id="command:submit"
            fg={foregroundProp(theme.accent)}
            onMouseDown={(event) => {
              event.stopPropagation();
              submitInput();
            }}
          >
            {" "}
            [ Apply ]{" "}
          </text>
        ) : null}
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
              {at === start ||
              results[at - 1]?.item.group !== row.item.group ? (
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
                            rangeEnd(row.titleRanges[index - 1]),
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

function rangeEnd(range: { start: number; length: number } | undefined) {
  return range ? range.start + range.length : 0;
}
