import {
  compareMatchScores,
  scoreMatch,
  scorePathMatch,
} from "@getpaseo/protocol/search/text-match";
import type {
  CommandListSource,
  CompletionPort,
  FileEntry,
  SlashCommand,
} from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";

export type Trigger =
  | {
      kind: "slash";
      start: number;
      end: number;
      query: string;
      position: "start" | "inline";
    }
  | { kind: "file"; start: number; end: number; query: string };
export interface CompletionItem {
  label: string;
  detail: string;
  value: string;
  final: boolean;
}
export type CompletionSnapshot =
  | { kind: "closed" }
  | {
      kind: "open";
      trigger: Trigger;
      items: readonly CompletionItem[];
      index: number;
      loading: boolean;
      error: string | null;
    };

const CLOSED_SNAPSHOT: CompletionSnapshot = { kind: "closed" };
/** Stand-in store for inputs without completion support. */
export const CLOSED_COMPLETIONS = {
  subscribe: (_listener: () => void) => () => {},
  getSnapshot: () => CLOSED_SNAPSHOT,
};
const SLASH_STOP = /[/\s"']/;
const FILE_STOP = /[\s"'<>]/;

/** Mirrors the Paseo app: `/` at prompt start or after whitespace, `@` not inside a word. */
export function findTrigger(text: string, cursor: number): Trigger | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, end);
  for (
    let at = before.lastIndexOf("@");
    at >= 0;
    at = at === 0 ? -1 : before.lastIndexOf("@", at - 1)
  ) {
    if (at > 0 && /[\w+]/.test(before[at - 1] ?? "")) continue;
    const query = before.slice(at + 1);
    if (!FILE_STOP.test(query)) return { kind: "file", start: at, end, query };
    break;
  }
  for (
    let at = before.lastIndexOf("/");
    at >= 0;
    at = at === 0 ? -1 : before.lastIndexOf("/", at - 1)
  ) {
    if (at > 0 && !/\s/.test(before[at - 1] ?? "")) continue;
    const query = before.slice(at + 1);
    if (!SLASH_STOP.test(query))
      return {
        kind: "slash",
        start: at,
        end,
        query,
        position: at === 0 ? "start" : "inline",
      };
    break;
  }
  return null;
}

export function rankCommands(
  commands: readonly SlashCommand[],
  { query, position }: { query: string; position: "start" | "inline" },
): SlashCommand[] {
  const eligible = commands.filter(
    (command) => position === "start" || command.kind === "skill",
  );
  const needle = query.trim().toLowerCase();
  if (!needle) return eligible;
  return eligible
    .flatMap((command) => {
      const score = scoreMatch(needle, command.name);
      return score ? [{ command, score }] : [];
    })
    .sort((a, b) => compareMatchScores(a.score, b.score))
    .map(({ command }) => command);
}

function rankFiles(entries: readonly FileEntry[], query: string): FileEntry[] {
  if (!query) return [...entries];
  const scored = entries.map((entry, order) => ({
    entry,
    order,
    score: scorePathMatch(query, entry.path),
  }));
  return scored
    .sort((a, b) =>
      a.score && b.score
        ? compareMatchScores(a.score, b.score) || a.order - b.order
        : a.score
          ? -1
          : b.score
            ? 1
            : a.order - b.order,
    )
    .map(({ entry }) => entry);
}

export function applyCompletion(
  text: string,
  trigger: Trigger,
  value: string,
  final = true,
): { text: string; cursor: number } {
  const quoted =
    trigger.kind === "file" && /\s/.test(value)
      ? `@"${value.slice(1).replace(/"/g, '\\"')}"`
      : value;
  const after = text.slice(trigger.end);
  const insert = final && after === "" ? `${quoted} ` : quoted;
  return {
    text: text.slice(0, trigger.start) + insert + after,
    cursor: trigger.start + insert.length,
  };
}

function commandItem(command: SlashCommand): CompletionItem {
  return {
    label: `/${command.name}`,
    detail: [command.argumentHint, command.description]
      .filter(Boolean)
      .join("  "),
    value: `/${command.name}`,
    final: true,
  };
}
function fileItem(entry: FileEntry): CompletionItem {
  const path =
    entry.kind === "directory" && !entry.path.endsWith("/")
      ? `${entry.path}/`
      : entry.path;
  return {
    label: path,
    detail: entry.kind === "directory" ? "directory" : "",
    value: `@${path}`,
    final: entry.kind === "file",
  };
}

type Debounce = (run: () => void) => () => void;
const defaultDebounce: Debounce = (run) => {
  const timer = setTimeout(run, 150);
  return () => clearTimeout(timer);
};

export function createCompletionStore(
  port: CompletionPort,
  target: { source: CommandListSource; cwd: string; debounce?: Debounce },
) {
  port.opened?.(target.source);
  const emitter = createEmitter();
  const debounce = target.debounce ?? defaultDebounce;
  let snapshot: CompletionSnapshot = { kind: "closed" };
  let commands:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; list: SlashCommand[] }
    | { kind: "error"; message: string } = { kind: "idle" };
  let text = "";
  let dismissedAt: { kind: Trigger["kind"]; start: number } | null = null;
  let cancelQuery: () => void = () => {};
  let fileGeneration = 0;
  let files: { query: string; entries: FileEntry[] } | null = null;
  let current: Trigger | null = null;

  function publish(next: CompletionSnapshot) {
    snapshot = next;
    emitter.notify();
  }
  function render() {
    const trigger = current;
    if (!trigger) {
      if (snapshot.kind !== "closed") publish({ kind: "closed" });
      return;
    }
    const index = snapshot.kind === "open" ? snapshot.index : 0;
    if (trigger.kind === "slash") {
      const items =
        commands.kind === "ready"
          ? rankCommands(commands.list, trigger).map(commandItem)
          : [];
      publish({
        kind: "open",
        trigger,
        items,
        index: Math.min(index, Math.max(0, items.length - 1)),
        loading: commands.kind === "loading" || commands.kind === "idle",
        error: commands.kind === "error" ? commands.message : null,
      });
      return;
    }
    const items = files ? rankFiles(files.entries, trigger.query) : [];
    publish({
      kind: "open",
      trigger,
      items: items.map(fileItem),
      index: Math.min(index, Math.max(0, items.length - 1)),
      loading: files?.query !== trigger.query,
      error: null,
    });
  }
  function loadCommands() {
    if (commands.kind !== "idle") return;
    commands = { kind: "loading" };
    port.commands(target.source).then(
      (list) => {
        commands = { kind: "ready", list };
        render();
      },
      (error: unknown) => {
        commands = {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        render();
      },
    );
  }
  function queryFiles(query: string) {
    cancelQuery();
    const generation = ++fileGeneration;
    cancelQuery = debounce(() => {
      port.files(target.cwd, query).then(
        (entries) => {
          if (generation !== fileGeneration) return;
          files = { query, entries };
          render();
        },
        () => {
          if (generation !== fileGeneration) return;
          files = { query, entries: [] };
          render();
        },
      );
    });
  }
  function update(nextText: string, cursor: number) {
    text = nextText;
    const trigger = findTrigger(nextText, cursor);
    if (
      dismissedAt &&
      (!trigger ||
        trigger.kind !== dismissedAt.kind ||
        trigger.start !== dismissedAt.start)
    )
      dismissedAt = null;
    const previous = current;
    current = dismissedAt ? null : trigger;
    if (!current) {
      cancelQuery();
      fileGeneration++;
      render();
      return;
    }
    if (previous?.kind !== current.kind || previous.start !== current.start)
      snapshot = { kind: "closed" };
    if (current.kind === "slash") loadCommands();
    else if (
      previous?.kind !== "file" ||
      previous.query !== current.query ||
      !files
    )
      queryFiles(current.query);
    render();
  }
  function move(delta: number) {
    if (snapshot.kind !== "open" || !snapshot.items.length) return;
    const count = snapshot.items.length;
    publish({
      ...snapshot,
      index: (((snapshot.index + delta) % count) + count) % count,
    });
  }
  function dismiss() {
    if (!current) return;
    dismissedAt = { kind: current.kind, start: current.start };
    current = null;
    cancelQuery();
    fileGeneration++;
    render();
  }
  function accept(index?: number) {
    if (snapshot.kind !== "open") return null;
    const item = snapshot.items[index ?? snapshot.index];
    if (!item) return null;
    const result = applyCompletion(
      text,
      snapshot.trigger,
      item.value,
      item.final,
    );
    current = null;
    files = null;
    cancelQuery();
    fileGeneration++;
    publish({ kind: "closed" });
    return result;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    update,
    move,
    dismiss,
    accept,
    close() {
      cancelQuery();
      fileGeneration++;
      emitter.clear();
    },
  };
}
export type CompletionStore = ReturnType<typeof createCompletionStore>;
