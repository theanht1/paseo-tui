import {
  decodePasteBytes,
  InputRenderable,
  TextAttributes,
} from "@opentui/core";
import { usePaste, useRenderer, useTerminalDimensions } from "@opentui/react";
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
import type { Action } from "../input/keymap.js";
import { listKey } from "../input/list-keys.js";
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
import { paletteSize } from "./palette-size.js";
import {
  type CommandItem,
  type CommandRegistry,
  type CommandStep,
  rankCommands,
  rowShortcut,
} from "./registry.js";
import { back, breadcrumb, push, type StackEntry } from "./steps.js";
export function CommandCenter({
  registry,
  initialStep,
  title = "Command Center",
  completions,
  shortcut = NO_SHORTCUT,
  onClose,
}: {
  registry: CommandRegistry;
  /** Labels an item's equivalent key binding, e.g. `g d`; none without it. */
  shortcut?(action: Action): string | null;
  initialStep?: CommandStep;
  title?: string;
  /** Serves `/` and `@` suggestions for input steps that ask for them. */
  completions?: CompletionPort;
  onClose(): void;
}) {
  const renderer = useRenderer();
  const [previousFocus] = useState(() => renderer.currentFocusedRenderable);
  /** Every input this has drawn (one per step); React clears refs before cleanup runs. */
  const inputs = useRef(new Set<InputRenderable>());
  useEffect(
    () => () => {
      // Hand focus back only if it is still ours: a dialog this opened (Add host…)
      // already focused its own input and must keep it.
      const now = renderer.currentFocusedRenderable;
      const ours =
        !now ||
        now.isDestroyed ||
        (now instanceof InputRenderable && inputs.current.has(now));
      if (ours && previousFocus && !previousFocus.isDestroyed)
        previousFocus.focus();
    },
    [previousFocus, renderer],
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
    const choice = step;
    let active = true;
    let latest = 0;
    function list() {
      const request = ++latest;
      const current = () => active && request === latest;
      Promise.resolve()
        .then(() => choice.items())
        .then(
          (items) => {
            if (current()) setChoices({ kind: "ready", items });
          },
          (error: unknown) => {
            if (current())
              setChoices({
                kind: "error",
                message: error instanceof Error ? error.message : String(error),
              });
          },
        );
    }
    setChoices({ kind: "loading" });
    list();
    const stop = choice.subscribe?.(list);
    return () => {
      active = false;
      stop?.();
    };
  }, [step]);
  useEffect(() => {
    if (step?.kind !== "search") return;
    let active = true;
    const timer = setTimeout(() => {
      step.search(query).then(
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
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [step, query]);
  const [readOnlyLines, setReadOnlyLines] = useState<readonly string[]>([]);
  useEffect(() => {
    if (step?.kind !== "readOnly") return;
    const update = () => setReadOnlyLines(step.lines());
    update();
    return step.subscribe?.(update);
  }, [step]);
  const [question, setQuestion] = useState<
    | { kind: "loading" }
    | { kind: "ready"; text: string | null }
    | { kind: "error"; message: string }
  >({ kind: "ready", text: null });
  useEffect(() => {
    if (step?.kind !== "confirm" || !step.prepare) {
      setQuestion({ kind: "ready", text: null });
      return;
    }
    let active = true;
    setQuestion({ kind: "loading" });
    step.prepare().then(
      (text) => {
        if (active) setQuestion({ kind: "ready", text });
      },
      (error: unknown) => {
        if (active)
          setQuestion({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [step]);
  const listed = step?.kind === "choice" || step?.kind === "search";
  const candidates = step
    ? listed && choices.kind === "ready"
      ? choices.items
      : []
    : registry.items();
  function rank(items: readonly CommandItem[], text: string) {
    return step?.kind === "search"
      ? items.map((item) => ({ item, titleRanges: [] }))
      : rankCommands(items, text);
  }
  const results = rank(candidates, query);
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
    setMissing(null);
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
    setMissing(null);
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
  const { height: boxHeight, capacity } = paletteSize(
    height,
    step?.kind === "search" && step.tall === true,
  );
  const start = Math.max(0, index - capacity + 1);
  function run(at: number) {
    const latest = stackRef.current.at(-1)?.query ?? rootRef.current.query;
    const row = (latest === query ? results : rank(candidates, latest))[at];
    if (!row) return;
    proceed(row.item.run());
  }
  const [missing, setMissing] = useState<string | null>(null);
  function submitInput() {
    if (step?.kind !== "input") return;
    const value = stackRef.current.at(-1)?.query ?? "";
    if (step.required && !value.trim()) {
      setMissing(`${step.required} is required`);
      return;
    }
    const problem = step.validate?.(value) ?? null;
    setMissing(problem);
    if (problem) return;
    proceed(step.submit(value));
  }
  const secret = step?.kind === "input" && step.secret === true;
  usePaste((event) => {
    if (!secret) return;
    event.preventDefault();
    const text = decodePasteBytes(event.bytes).replace(/[\r\n]+/g, "");
    change((stackRef.current.at(-1)?.query ?? "") + text, 0);
  });
  useKeyOwner(true, (stroke) => {
    // A secret field is drawn as dots, so it edits its value here instead of in an <input>.
    if (secret && stroke.name !== "return" && stroke.name !== "escape") {
      const value = stackRef.current.at(-1)?.query ?? "";
      if (stroke.name === "backspace")
        change(Array.from(value).slice(0, -1).join(""), 0);
      else if (stroke.ctrl && stroke.name === "u") change("", 0);
      else if (
        !stroke.ctrl &&
        !stroke.meta &&
        !stroke.super &&
        Array.from(stroke.sequence).length === 1 &&
        !/\p{Cc}/u.test(stroke.sequence)
      )
        change(value + stroke.sequence, 0);
      return true;
    }
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
    const jump =
      !stroke.ctrl && JUMP_KEYS.has(stroke.name)
        ? listKey(
            stroke,
            { cursor: selection.current, pendingG: false },
            step?.kind === "readOnly" ? readOnlyLines.length : results.length,
            capacity,
          )
        : "pass";
    const target =
      jump === "pass"
        ? stroke.name === "down" || (stroke.ctrl && stroke.name === "n")
          ? selection.current + 1
          : stroke.name === "up" || (stroke.ctrl && stroke.name === "p")
            ? selection.current - 1
            : null
        : jump.cursor;
    if (step?.kind === "readOnly") {
      if (stroke.name === "escape") goBack();
      else if (target !== null)
        change("", Math.max(0, Math.min(readOnlyLines.length - 1, target)));
      else return false;
      return true;
    }
    if (step?.kind === "confirm") {
      if (!["y", "n", "escape"].includes(stroke.name)) return false;
      if (stroke.name === "y") {
        if (question.kind !== "ready") return true;
        step.confirm();
        onClose();
      } else goBack();
      return true;
    }
    if (stroke.name === "escape") goBack();
    else if (stroke.name === "return") {
      if (step?.kind === "input") submitInput();
      else run(selection.current);
    } else if (target !== null) {
      selection.current = Math.max(0, Math.min(results.length - 1, target));
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
              if (question.kind !== "ready") return;
              step.confirm();
              onClose();
            }}
          >
            <text
              fg={foregroundProp(
                question.kind === "error" ? theme.error : theme.fg,
              )}
            >
              {question.kind === "loading"
                ? "Loading…"
                : question.kind === "error"
                  ? `! ${question.message} · n/Esc back`
                  : `${question.text ?? "Confirm"} · y confirm · n/Esc back`}
            </text>
          </box>
        ) : step?.kind === "readOnly" ? null : secret ? (
          <text
            id="command:secret"
            height={1}
            wrapMode="none"
            fg={foregroundProp(query ? theme.fg : theme.muted)}
          >
            {query
              ? `${"•".repeat(Array.from(query).length)}▌`
              : step?.kind === "input"
                ? step.placeholder
                : ""}
          </text>
        ) : (
          <input
            ref={(node: InputRenderable | null) => {
              if (node) inputs.current.add(node);
            }}
            key={stack.length}
            textColor={foregroundProp(theme.fg)}
            focusedTextColor={foregroundProp(theme.fg)}
            backgroundColor={backgroundProp(theme.codeBg)}
            focusedBackgroundColor={backgroundProp(theme.codeBg)}
            placeholderColor={foregroundProp(theme.muted)}
            focused
            placeholder={
              step?.kind === "input" || step?.kind === "search"
                ? step.placeholder
                : "Search commands…"
            }
            value={query}
            onInput={setInput}
          />
        )}
        {step?.kind === "readOnly"
          ? readOnlyLines
              .slice(
                Math.max(0, selected - capacity + 1),
                Math.max(0, selected - capacity + 1) + capacity,
              )
              .map((line) => (
                <text
                  key={line}
                  height={1}
                  wrapMode="none"
                  fg={foregroundProp(theme.fg)}
                >
                  {line}
                </text>
              ))
          : null}
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
        {missing ? (
          <text id="command:missing" fg={foregroundProp(theme.error)}>
            ! {missing}
          </text>
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
        {listed && choices.kind === "loading" ? (
          <text fg={foregroundProp(theme.muted)}>
            {(step.kind === "choice" && step.loading) || "Loading…"}
          </text>
        ) : null}
        {listed && choices.kind === "error" ? (
          <text fg={foregroundProp(theme.error)}>! {choices.message}</text>
        ) : null}
        {(!step || (listed && choices.kind === "ready")) &&
        results.length === 0 ? (
          <text fg={foregroundProp(theme.muted)}>
            {step?.kind === "search" ? "No matches" : "No commands match"}
          </text>
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
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  height={1}
                >
                  <text
                    fg={foregroundProp(theme.fg)}
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    height={1}
                    wrapMode="none"
                    truncate
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
                  {rowShortcut(row.item, shortcut) ? (
                    <text
                      height={1}
                      flexShrink={0}
                      wrapMode="none"
                      fg={foregroundProp(theme.faint)}
                    >
                      {`  ${rowShortcut(row.item, shortcut)}`}
                    </text>
                  ) : null}
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

function NO_SHORTCUT() {
  return null;
}
/** Pause after typing before asking the host, so each keystroke doesn't search. */
const JUMP_KEYS: ReadonlySet<string> = new Set(["pageup", "pagedown"]);
const SEARCH_DELAY_MS = 150;
function rangeEnd(range: { start: number; length: number } | undefined) {
  return range ? range.start + range.length : 0;
}
