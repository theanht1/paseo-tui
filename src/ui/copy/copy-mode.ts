/** Theme colors a copy-mode line can take (see Theme). */
export type Tone =
  | "fg"
  | "muted"
  | "faint"
  | "accent"
  | "user"
  | "reasoning"
  | "error"
  | "warn"
  | "success"
  | "tool"
  | "heading1"
  | "heading2"
  | "heading3";
/** A styled column range `[start, end)` within a line. */
export interface Mark {
  start: number;
  end: number;
  tone: Tone;
  bold?: true;
}
export interface LineStyle {
  tone: Tone;
  bold: boolean;
  marks: readonly Mark[];
}
export interface DocLine {
  text: string;
  /** True when this row is a soft-wrapped continuation of the previous row. */
  continued: boolean;
  /** How the timeline colors it; absent draws plain text. */
  style?: LineStyle;
}
export interface Point {
  row: number;
  col: number;
}
type FindOp = "f" | "F" | "t" | "T";
interface SearchSpec {
  dir: 1 | -1;
  query: string;
  /** `*` and `#` match the whole word only. */
  word?: boolean;
}
export interface CopyState {
  lines: readonly DocLine[];
  cursor: Point;
  /** `block` is a rectangle (Ctrl-v). */
  selection: { kind: "char" | "line" | "block"; anchor: Point } | null;
  /** A key waiting for its second half: `g` (gg, gf) or a find's character. */
  pending: "" | "g" | FindOp;
  /** The `/` or `?` query being typed. */
  search: { dir: 1 | -1; query: string } | null;
  lastFind: { op: FindOp; char: string } | null;
  lastSearch: SearchSpec | null;
  /** Digits typed before a motion (`5j`). */
  count: string;
  pageSize: number;
  top: number;
}
export type CopyEffect =
  | { kind: "none" }
  | { kind: "exit" }
  | { kind: "yank"; text: string }
  /** `gf`: the unwrapped line under the cursor and the cursor's column in it. */
  | { kind: "file"; text: string; col: number };

export function documentLines(
  texts: readonly string[],
  width: number,
): DocLine[] {
  const size = Math.max(1, width);
  return texts.flatMap((text) => {
    const chars = Array.from(text);
    if (chars.length <= size) return [{ text, continued: false }];
    const rows: DocLine[] = [];
    for (let at = 0; at < chars.length; at += size)
      rows.push({
        text: chars.slice(at, at + size).join(""),
        continued: at > 0,
      });
    return rows;
  });
}

/** Wraps styled lines like `documentLines`, cutting each mark to the rows it spans. */
export function styledDocumentLines(
  lines: readonly { text: string; style: LineStyle }[],
  width: number,
): DocLine[] {
  const size = Math.max(1, width);
  return lines.flatMap(({ text, style }) => {
    const chars = Array.from(text);
    const rows: DocLine[] = [];
    for (let at = 0; at < Math.max(1, chars.length); at += size) {
      const end = at + size;
      rows.push({
        text: chars.slice(at, end).join(""),
        continued: at > 0,
        style: {
          ...style,
          marks: style.marks.flatMap((mark) =>
            mark.end <= at || mark.start >= end
              ? []
              : [
                  {
                    ...mark,
                    start: Math.max(mark.start, at) - at,
                    end: Math.min(mark.end, end) - at,
                  },
                ],
          ),
        },
      });
    }
    return rows;
  });
}
function length(state: CopyState, row: number) {
  return Array.from(state.lines[row]?.text ?? "").length;
}
function clampCol(state: CopyState, row: number, col: number) {
  return Math.max(0, Math.min(col, Math.max(0, length(state, row) - 1)));
}
function scrolled(state: CopyState): CopyState {
  const { row } = state.cursor;
  const top =
    row < state.top
      ? row
      : row >= state.top + state.pageSize
        ? row - state.pageSize + 1
        : state.top;
  return { ...state, top: Math.max(0, top) };
}
function moveTo(state: CopyState, cursor: Point): CopyState {
  const row = Math.max(0, Math.min(state.lines.length - 1, cursor.row));
  return scrolled({
    ...state,
    pending: "",
    cursor: { row, col: clampCol(state, row, cursor.col) },
  });
}

export function startCopy(
  lines: readonly DocLine[],
  pageSize: number,
): CopyState {
  const doc = lines.length ? lines : [{ text: "", continued: false }];
  return scrolled({
    lines: doc,
    cursor: { row: doc.length - 1, col: 0 },
    selection: null,
    pending: "",
    search: null,
    lastFind: null,
    lastSearch: null,
    count: "",
    pageSize: Math.max(1, pageSize),
    top: 0,
  });
}

/**
 * The same state over a new document whose first `shift` lines are new (older
 * history paged in above): cursor, viewport and selection stay on their text.
 */
export function rebaseCopy(
  state: CopyState,
  lines: readonly DocLine[],
  shift: number,
): CopyState {
  const doc = lines.length ? lines : [{ text: "", continued: false }];
  const last = doc.length - 1;
  const at = (point: Point): Point => {
    const row = Math.max(0, Math.min(last, point.row + shift));
    return { row, col: point.col };
  };
  const next = { ...state, lines: doc };
  const cursor = at(state.cursor);
  return {
    ...next,
    cursor: { row: cursor.row, col: clampCol(next, cursor.row, cursor.col) },
    selection: state.selection && {
      ...state.selection,
      anchor: at(state.selection.anchor),
    },
    top: Math.max(0, Math.min(last, state.top + shift)),
  };
}

type CharClass = 0 | 1 | 2;
type Classify = (char: string | undefined) => CharClass;
/** vim words: runs of word characters, or of other non-blank characters. */
const wordClass: Classify = (char) => {
  if (char === undefined || /\s/.test(char)) return 0;
  return /\w/.test(char) ? 1 : 2;
};
/** vim WORDs: runs of non-blank characters. */
const bigWordClass: Classify = (char) =>
  char === undefined || /\s/.test(char) ? 0 : 1;
function charAt(state: CopyState, point: Point) {
  return Array.from(state.lines[point.row]?.text ?? "")[point.col];
}
/** Next position in reading order; an empty line is a single position. */
function step(state: CopyState, point: Point, dir: 1 | -1): Point | null {
  const col = point.col + dir;
  if (col >= 0 && col < length(state, point.row))
    return { row: point.row, col };
  const row = point.row + dir;
  if (row < 0 || row >= state.lines.length) return null;
  return { row, col: dir === 1 ? 0 : Math.max(0, length(state, row) - 1) };
}
function isEmptyLine(state: CopyState, point: Point) {
  return length(state, point.row) === 0;
}
function wordForward(state: CopyState, charClass: Classify): Point {
  let point = state.cursor;
  const start = charClass(charAt(state, point));
  let next = step(state, point, 1);
  while (
    next &&
    start !== 0 &&
    next.row === point.row &&
    charClass(charAt(state, next)) === start
  ) {
    point = next;
    next = step(state, point, 1);
  }
  while (
    next &&
    !isEmptyLine(state, next) &&
    charClass(charAt(state, next)) === 0
  )
    next = step(state, next, 1);
  return next ?? state.cursor;
}
function wordEnd(state: CopyState, charClass: Classify): Point {
  let next = step(state, state.cursor, 1);
  while (next && charClass(charAt(state, next)) === 0)
    next = step(state, next, 1);
  if (!next) return state.cursor;
  let point = next;
  const kind = charClass(charAt(state, point));
  let after = step(state, point, 1);
  while (
    after &&
    after.row === point.row &&
    charClass(charAt(state, after)) === kind
  ) {
    point = after;
    after = step(state, point, 1);
  }
  return point;
}
function wordBackward(state: CopyState, charClass: Classify): Point {
  let previous = step(state, state.cursor, -1);
  while (
    previous &&
    !isEmptyLine(state, previous) &&
    charClass(charAt(state, previous)) === 0
  )
    previous = step(state, previous, -1);
  if (!previous) return state.cursor;
  let point = previous;
  const kind = charClass(charAt(state, point));
  let before = step(state, point, -1);
  while (
    kind !== 0 &&
    before &&
    before.row === point.row &&
    charClass(charAt(state, before)) === kind
  ) {
    point = before;
    before = step(state, point, -1);
  }
  return point;
}

function logicalLine(state: CopyState): { text: string; col: number } {
  let first = state.cursor.row;
  while (first > 0 && state.lines[first]?.continued) first--;
  let last = state.cursor.row;
  while (state.lines[last + 1]?.continued) last++;
  let text = "";
  let col = 0;
  for (let row = first; row <= last; row++) {
    if (row === state.cursor.row)
      col = Array.from(text).length + state.cursor.col;
    text += state.lines[row]?.text ?? "";
  }
  return { text, col };
}
function ordered(a: Point, b: Point): [Point, Point] {
  return a.row < b.row || (a.row === b.row && a.col <= b.col) ? [a, b] : [b, a];
}
/** Half-open column span selected on `row`, or null. */
export function selectionSpan(
  state: CopyState,
  row: number,
): { start: number; end: number } | null {
  if (!state.selection) return null;
  const [from, to] = ordered(state.selection.anchor, state.cursor);
  if (row < from.row || row > to.row) return null;
  const size = length(state, row);
  if (state.selection.kind === "line") return { start: 0, end: size };
  if (state.selection.kind === "block") {
    const left = Math.min(state.selection.anchor.col, state.cursor.col);
    const right = Math.max(state.selection.anchor.col, state.cursor.col);
    return { start: Math.min(left, size), end: Math.min(size, right + 1) };
  }
  return {
    start: row === from.row ? from.col : 0,
    end: row === to.row ? Math.min(size, to.col + 1) : size,
  };
}
function yank(state: CopyState): string {
  const selection = state.selection ?? {
    kind: "line" as const,
    anchor: state.cursor,
  };
  const scoped = { ...state, selection };
  const [from, to] = ordered(selection.anchor, state.cursor);
  let text = "";
  for (let row = from.row; row <= to.row; row++) {
    const span = selectionSpan(scoped, row);
    const chars = Array.from(state.lines[row]?.text ?? "");
    const piece = span ? chars.slice(span.start, span.end).join("") : "";
    text +=
      row === from.row
        ? piece
        : state.lines[row]?.continued && selection.kind !== "block"
          ? piece
          : `\n${piece}`;
  }
  return text;
}

function firstNonBlank(state: CopyState, row: number) {
  const index = Array.from(state.lines[row]?.text ?? "").findIndex(
    (char) => !/\s/.test(char),
  );
  return Math.max(0, index);
}
/** `{` / `}`: the next blank line past the current run, or the first/last line. */
function paragraph(state: CopyState, dir: 1 | -1): Point {
  const blank = (row: number) => length(state, row) === 0;
  let row = state.cursor.row + dir;
  if (blank(state.cursor.row))
    while (row >= 0 && row < state.lines.length && blank(row)) row += dir;
  while (row >= 0 && row < state.lines.length && !blank(row)) row += dir;
  if (row < 0) return { row: 0, col: 0 };
  if (row >= state.lines.length) return { row: state.lines.length - 1, col: 0 };
  return { row, col: 0 };
}
/** `f F t T`: the character on the cursor's line. */
function find(state: CopyState, op: FindOp, char: string): Point {
  const chars = Array.from(state.lines[state.cursor.row]?.text ?? "");
  const { col } = state.cursor;
  const forward = op === "f" || op === "t";
  const at = forward
    ? chars.findIndex(
        (c, index) => index > col + (op === "t" ? 1 : 0) && c === char,
      )
    : chars.findLastIndex(
        (c, index) => index < col - (op === "T" ? 1 : 0) && c === char,
      );
  if (at < 0) return state.cursor;
  const target = op === "t" ? at - 1 : op === "T" ? at + 1 : at;
  return { row: state.cursor.row, col: target };
}
const REVERSE: Record<FindOp, FindOp> = { f: "F", F: "f", t: "T", T: "t" };
const PAIRS: Record<string, { other: string; dir: 1 | -1 }> = {
  "(": { other: ")", dir: 1 },
  "[": { other: "]", dir: 1 },
  "{": { other: "}", dir: 1 },
  ")": { other: "(", dir: -1 },
  "]": { other: "[", dir: -1 },
  "}": { other: "{", dir: -1 },
};
/** `%`: the bracket matching the first one at or after the cursor on its line. */
function matchBracket(state: CopyState): Point {
  const chars = Array.from(state.lines[state.cursor.row]?.text ?? "");
  const col = chars.findIndex(
    (char, index) => index >= state.cursor.col && char in PAIRS,
  );
  const open = chars[col];
  const pair = open === undefined ? undefined : PAIRS[open];
  if (!open || !pair) return state.cursor;
  let depth = 0;
  for (
    let point: Point | null = { row: state.cursor.row, col };
    point;
    point = step(state, point, pair.dir)
  ) {
    const char = charAt(state, point);
    if (char === open) depth++;
    else if (char === pair.other && --depth === 0) return point;
  }
  return state.cursor;
}
function matches(text: string, spec: SearchSpec): number[] {
  const chars = Array.from(text);
  const fold = !spec.word && spec.query === spec.query.toLowerCase();
  const haystack = fold ? text.toLowerCase() : text;
  const needle = Array.from(spec.query);
  const found: number[] = [];
  const hay = Array.from(haystack);
  for (let at = 0; at + needle.length <= hay.length; at++) {
    if (needle.some((char, index) => hay[at + index] !== char)) continue;
    if (
      spec.word &&
      (/\w/.test(chars[at - 1] ?? "") ||
        /\w/.test(chars[at + needle.length] ?? ""))
    )
      continue;
    found.push(at);
  }
  return found;
}
/** The next match after the cursor in `dir`, wrapping around the document. */
function searchFrom(state: CopyState, spec: SearchSpec, dir: 1 | -1): Point {
  if (!spec.query) return state.cursor;
  const count = state.lines.length;
  for (let offset = 0; offset <= count; offset++) {
    const row = (((state.cursor.row + dir * offset) % count) + count) % count;
    const cols = matches(state.lines[row]?.text ?? "", spec);
    const col =
      dir === 1
        ? cols.find((c) => offset > 0 || c > state.cursor.col)
        : cols.findLast((c) => offset > 0 || c < state.cursor.col);
    if (col !== undefined && !(offset === count && col === state.cursor.col))
      return { row, col };
  }
  return state.cursor;
}
/** The word under the cursor, for `*` and `#`. */
function wordAt(state: CopyState): string | null {
  const chars = Array.from(state.lines[state.cursor.row]?.text ?? "");
  if (!/\w/.test(chars[state.cursor.col] ?? "")) return null;
  let start = state.cursor.col;
  let end = state.cursor.col;
  while (start > 0 && /\w/.test(chars[start - 1] ?? "")) start--;
  while (end + 1 < chars.length && /\w/.test(chars[end + 1] ?? "")) end++;
  return chars.slice(start, end + 1).join("");
}
/** Scrolls the screen a line (Ctrl-e / Ctrl-y, J / K), keeping the cursor on it. */
function scrollLine(state: CopyState, dir: 1 | -1): CopyState {
  const maxTop = Math.max(0, state.lines.length - state.pageSize);
  const top = Math.max(0, Math.min(maxTop, state.top + dir));
  const row = Math.max(
    top,
    Math.min(top + state.pageSize - 1, state.cursor.row),
  );
  return {
    ...state,
    pending: "",
    top,
    cursor: { row, col: clampCol(state, row, state.cursor.col) },
  };
}
/** Mouse wheel: scrolls `lines` (negative is up), dragging the cursor along. */
export function scrollCopy(state: CopyState, lines: number): CopyState {
  let next = state;
  const dir = lines < 0 ? -1 : 1;
  for (let index = 0; index < Math.abs(lines); index++)
    next = scrollLine(next, dir);
  return next;
}
/** Keys a count (`5j`) repeats. */
const REPEATABLE = new Set([
  "h",
  "j",
  "k",
  "l",
  "Left",
  "Right",
  "Up",
  "Down",
  "w",
  "b",
  "e",
  "W",
  "B",
  "E",
  "{",
  "}",
  ";",
  ",",
  "n",
  "N",
  "u",
  "d",
  "Ctrl-u",
  "Ctrl-d",
  "Ctrl-b",
  "Ctrl-f",
  "PgUp",
  "PgDn",
  "Ctrl-e",
  "Ctrl-y",
  "J",
  "K",
]);
type Result = { state: CopyState; effect: CopyEffect };
const none = (state: CopyState): Result => ({
  state,
  effect: { kind: "none" },
});
function searchKey(state: CopyState, key: string): Result {
  const typing = state.search;
  if (!typing) return none(state);
  if (key === "Esc" || key === "Ctrl-c")
    return none({ ...state, search: null });
  if (key === "Enter") {
    const spec = { dir: typing.dir, query: typing.query };
    const searched = { ...state, search: null, lastSearch: spec };
    return none(moveTo(searched, searchFrom(searched, spec, spec.dir)));
  }
  const query =
    key === "backspace"
      ? Array.from(typing.query).slice(0, -1).join("")
      : key === "space" || key === "Space"
        ? `${typing.query} `
        : Array.from(key).length === 1
          ? typing.query + key
          : typing.query;
  return none({ ...state, search: { ...typing, query } });
}
/** One key in copy mode (vi keys as tmux has them), with any count typed before it. */
export function copyKey(state: CopyState, key: string): Result {
  if (state.search) return searchKey(state, key);
  if (!state.pending && /^[1-9]$/.test(key))
    return none({ ...state, count: state.count + key });
  if (!state.pending && key === "0" && state.count)
    return none({ ...state, count: `${state.count}0` });
  const times = Math.min(Number(state.count) || 1, 10_000);
  let current: CopyState = { ...state, count: "" };
  if (!REPEATABLE.has(key)) return motion(current, key);
  let result = none(current);
  for (let index = 0; index < times; index++) {
    result = motion(current, key);
    current = result.state;
  }
  return result;
}
function motion(state: CopyState, key: string): Result {
  const { cursor } = state;
  const half = Math.max(1, Math.floor(state.pageSize / 2));
  if (state.pending === "g" && key === "g")
    return none(moveTo(state, { row: 0, col: 0 }));
  if (state.pending === "g" && key === "f")
    return {
      state: { ...state, pending: "" },
      effect: { kind: "file", ...logicalLine(state) },
    };
  if (state.pending && state.pending !== "g") {
    const op = state.pending;
    const char = key === "space" || key === "Space" ? " " : key;
    if (Array.from(char).length !== 1) return none({ ...state, pending: "" });
    return none(
      moveTo({ ...state, lastFind: { op, char } }, find(state, op, char)),
    );
  }
  const visible = Math.max(
    1,
    Math.min(state.pageSize, state.lines.length - state.top),
  );
  switch (key) {
    case "g":
      return none({ ...state, pending: "g" });
    case "h":
    case "Left":
      return none(moveTo(state, { ...cursor, col: cursor.col - 1 }));
    case "l":
    case "Right":
      return none(moveTo(state, { ...cursor, col: cursor.col + 1 }));
    case "j":
    case "Down":
      return none(moveTo(state, { ...cursor, row: cursor.row + 1 }));
    case "k":
    case "Up":
      return none(moveTo(state, { ...cursor, row: cursor.row - 1 }));
    case "0":
    case "Home":
      return none(moveTo(state, { ...cursor, col: 0 }));
    case "^":
      return none(
        moveTo(state, { ...cursor, col: firstNonBlank(state, cursor.row) }),
      );
    case "$":
    case "End":
      return none(moveTo(state, { ...cursor, col: Number.MAX_SAFE_INTEGER }));
    case "G":
      return none(moveTo(state, { row: state.lines.length - 1, col: 0 }));
    case "H":
      return none(moveTo(state, { row: state.top, col: 0 }));
    case "M":
      return none(
        moveTo(state, {
          row: state.top + Math.floor((visible - 1) / 2),
          col: 0,
        }),
      );
    case "L":
      return none(moveTo(state, { row: state.top + visible - 1, col: 0 }));
    case "w":
      return none(moveTo(state, wordForward(state, wordClass)));
    case "b":
      return none(moveTo(state, wordBackward(state, wordClass)));
    case "e":
      return none(moveTo(state, wordEnd(state, wordClass)));
    case "W":
      return none(moveTo(state, wordForward(state, bigWordClass)));
    case "B":
      return none(moveTo(state, wordBackward(state, bigWordClass)));
    case "E":
      return none(moveTo(state, wordEnd(state, bigWordClass)));
    case "{":
      return none(moveTo(state, paragraph(state, -1)));
    case "}":
      return none(moveTo(state, paragraph(state, 1)));
    case "%":
      return none(moveTo(state, matchBracket(state)));
    case "f":
    case "F":
    case "t":
    case "T":
      return none({ ...state, pending: key });
    case ";":
    case ",": {
      const last = state.lastFind;
      if (!last) return none(state);
      const op = key === ";" ? last.op : REVERSE[last.op];
      return none(moveTo(state, find(state, op, last.char)));
    }
    case "/":
    case "?":
      return none({
        ...state,
        pending: "",
        search: { dir: key === "/" ? 1 : -1, query: "" },
      });
    case "n":
    case "N": {
      const last = state.lastSearch;
      if (!last) return none(state);
      const dir = key === "n" ? last.dir : last.dir === 1 ? -1 : 1;
      return none(moveTo(state, searchFrom(state, last, dir)));
    }
    case "*":
    case "#": {
      const word = wordAt(state);
      if (!word) return none(state);
      const spec: SearchSpec = {
        dir: key === "*" ? 1 : -1,
        query: word,
        word: true,
      };
      return none(
        moveTo(
          { ...state, lastSearch: spec },
          searchFrom(state, spec, spec.dir),
        ),
      );
    }
    case "u":
    case "Ctrl-u":
      return none(moveTo(state, { ...cursor, row: cursor.row - half }));
    case "d":
    case "Ctrl-d":
      return none(moveTo(state, { ...cursor, row: cursor.row + half }));
    case "Ctrl-b":
    case "PgUp":
      return none(
        moveTo(state, { ...cursor, row: cursor.row - state.pageSize }),
      );
    case "Ctrl-f":
    case "PgDn":
      return none(
        moveTo(state, { ...cursor, row: cursor.row + state.pageSize }),
      );
    case "Ctrl-e":
    case "J":
      return none(scrollLine(state, 1));
    case "Ctrl-y":
    case "K":
      return none(scrollLine(state, -1));
    case "v":
    case "V": {
      const kind = key === "v" ? "char" : "line";
      return none({
        ...state,
        pending: "",
        selection:
          state.selection?.kind === kind ? null : { kind, anchor: cursor },
      });
    }
    case "space":
    case "Space":
      return none({
        ...state,
        pending: "",
        selection: { kind: "char", anchor: cursor },
      });
    case "Ctrl-v":
      return none({
        ...state,
        pending: "",
        selection:
          state.selection?.kind === "block"
            ? { ...state.selection, kind: "char" }
            : { kind: "block", anchor: state.selection?.anchor ?? cursor },
      });
    case "o": {
      const selection = state.selection;
      if (!selection) return none(state);
      return none(
        moveTo(
          { ...state, selection: { ...selection, anchor: cursor } },
          selection.anchor,
        ),
      );
    }
    case "y":
    case "Enter":
      return { state, effect: { kind: "yank", text: yank(state) } };
    case "Esc":
      return state.selection
        ? none({ ...state, selection: null, pending: "" })
        : { state, effect: { kind: "exit" } };
    case "q":
    case "Ctrl-c":
      return { state, effect: { kind: "exit" } };
    default:
      return none({ ...state, pending: "" });
  }
}
