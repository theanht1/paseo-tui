import {
  compareMatchScores,
  type MatchRange,
  type MatchScore,
  matchRanges,
  scoreMatch,
  tokenizeQuery,
} from "@getpaseo/protocol/search/text-match";
import type { CommandListSource } from "../../connection/ports.js";
import type { Action } from "../input/keymap.js";
export type CommandGroup =
  | "Needs you"
  | "Agents"
  | "Agent"
  | "Workspaces"
  | "Schedules"
  | "Usage"
  | "Actions"
  | "View";
export interface CommandItem {
  id: string;
  group: CommandGroup;
  title: string;
  subtitle?: string;
  keywords?: readonly string[];
  /** The key binding this item is equivalent to; its shortcut is shown on the right. */
  action?: Action;
  recency?: number;
  run(): undefined | CommandStep;
}
/** The shortcut shown at the right of an item's row, from the effective key bindings. */
export function rowShortcut(
  item: CommandItem,
  shortcut: (action: Action) => string | null,
): string {
  return item.action ? (shortcut(item.action) ?? "") : "";
}
export interface CommandSource {
  id: string;
  items(): readonly CommandItem[];
}
export interface CommandRegistry {
  register(source: CommandSource): () => void;
  items(): CommandItem[];
}
export function createCommandRegistry(): CommandRegistry {
  const sources = new Map<string, CommandSource>();
  return {
    register(source) {
      sources.set(source.id, source);
      return () => {
        if (sources.get(source.id) === source) sources.delete(source.id);
      };
    },
    items() {
      return [...sources.values()].flatMap((source) => [...source.items()]);
    },
  };
}
const GROUPS: readonly CommandGroup[] = [
  "Needs you",
  "Agents",
  "Agent",
  "Workspaces",
  "Schedules",
  "Usage",
  "Actions",
  "View",
];
interface TokenMatch {
  field: number;
  score: MatchScore;
}
function tokenMatch(item: CommandItem, token: string): TokenMatch | null {
  const fields = [item.title, item.subtitle ?? "", ...(item.keywords ?? [])];
  let best: TokenMatch | null = null;
  for (const [index, field] of fields.entries()) {
    const score = scoreMatch(token, field);
    if (!score) continue;
    const candidate = { field: Math.min(index, 2), score };
    if (!best || compareTokens(candidate, best) < 0) best = candidate;
  }
  return best;
}
function compareTokens(a: TokenMatch, b: TokenMatch): number {
  return a.field - b.field || compareMatchScores(a.score, b.score);
}
function titleRanges(item: CommandItem, tokens: string[]): MatchRange[] {
  const positions = new Set<number>();
  for (const token of tokens) {
    const score = scoreMatch(token, item.title);
    if (score)
      for (const range of matchRanges(token, item.title, score))
        for (let i = range.start; i < range.start + range.length; i++)
          positions.add(i);
  }
  const ranges: MatchRange[] = [];
  for (const position of [...positions].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last.start + last.length === position) last.length++;
    else ranges.push({ start: position, length: 1 });
  }
  return ranges;
}
export function rankCommands(
  items: readonly CommandItem[],
  query: string,
): { item: CommandItem; titleRanges: MatchRange[] }[] {
  const tokens = tokenizeQuery(query);
  const ranked = items.flatMap((item) => {
    const matches: TokenMatch[] = [];
    for (const token of tokens) {
      const match = tokenMatch(item, token);
      if (!match) return [];
      matches.push(match);
    }
    return [{ item, matches }];
  });
  ranked.sort((a, b) => {
    if (tokens.length) {
      const fields =
        a.matches.reduce((sum, m) => sum + m.field, 0) -
        b.matches.reduce((sum, m) => sum + m.field, 0);
      if (fields) return fields;
      for (const [i, match] of a.matches.entries()) {
        const other = b.matches[i];
        if (!other) break;
        const score = compareMatchScores(match.score, other.score);
        if (score) return score;
      }
      const recent = (b.item.recency ?? 0) - (a.item.recency ?? 0);
      if (recent) return recent;
    }
    return (
      GROUPS.indexOf(a.item.group) - GROUPS.indexOf(b.item.group) ||
      (b.item.recency ?? 0) - (a.item.recency ?? 0)
    );
  });
  return ranked.map(({ item }) => ({
    item,
    titleRanges: titleRanges(item, tokens),
  }));
}

export type CommandStep =
  | {
      kind: "readOnly";
      title: string;
      lines(): readonly string[];
      subscribe?(listener: () => void): () => void;
    }
  | {
      kind: "choice";
      title: string;
      items(): readonly CommandItem[] | Promise<readonly CommandItem[]>;
      /** Shown while `items` is pending; "Loading…" by default. */
      loading?: string;
      /** Lists `items` again whenever the listener is called. */
      subscribe?(listener: () => void): () => void;
    }
  | {
      kind: "input";
      title: string;
      placeholder: string;
      initial?: string;
      /** Offers `/` command and `@` file completions while typing. */
      completion?: { source: CommandListSource; cwd: string };
      /** Hides what is typed (a password); paste works, nothing is drawn but dots. */
      secret?: true;
      /** Enter on a blank value stays and says "<required> is required". */
      required?: string;
      /** Why Enter would do nothing for this value; shown instead of submitting. */
      validate?(text: string): string | null;
      submit(text: string): undefined | CommandStep;
    }
  | {
      /** Like `choice`, but the items come from `search` as you type instead of filtering a fixed list. */
      kind: "search";
      title: string;
      placeholder: string;
      /** Fills the terminal height to list more rows (long lists such as History). */
      tall?: true;
      search(query: string): Promise<readonly CommandItem[]>;
    }
  | {
      kind: "confirm";
      title: string;
      /** The question, loaded first (e.g. a count); `y` waits for it. */
      prepare?(): Promise<string>;
      confirm(): void;
    };
