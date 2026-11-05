export interface DocLine {
  text: string;
  /** True when this row is a soft-wrapped continuation of the previous row. */
  continued: boolean;
}
export interface Point {
  row: number;
  col: number;
}
export interface CopyState {
  lines: readonly DocLine[];
  cursor: Point;
  selection: { kind: "char" | "line"; anchor: Point } | null;
  pending: "" | "g";
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
    pageSize: Math.max(1, pageSize),
    top: 0,
  });
}

type CharClass = 0 | 1 | 2;
function charClass(char: string | undefined): CharClass {
  if (char === undefined || /\s/.test(char)) return 0;
  return /\w/.test(char) ? 1 : 2;
}
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
function wordForward(state: CopyState): Point {
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
function wordEnd(state: CopyState): Point {
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
function wordBackward(state: CopyState): Point {
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
        : state.lines[row]?.continued
          ? piece
          : `\n${piece}`;
  }
  return text;
}

export function copyKey(
  state: CopyState,
  key: string,
): { state: CopyState; effect: CopyEffect } {
  const none = (next: CopyState) => ({
    state: next,
    effect: { kind: "none" } as const,
  });
  const { cursor } = state;
  const half = Math.max(1, Math.floor(state.pageSize / 2));
  if (state.pending === "g" && key === "g")
    return none(moveTo(state, { row: 0, col: 0 }));
  if (state.pending === "g" && key === "f")
    return {
      state: { ...state, pending: "" },
      effect: { kind: "file", ...logicalLine(state) },
    };
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
      return none(moveTo(state, { ...cursor, col: 0 }));
    case "$":
      return none(moveTo(state, { ...cursor, col: Number.MAX_SAFE_INTEGER }));
    case "G":
      return none(moveTo(state, { row: state.lines.length - 1, col: 0 }));
    case "w":
      return none(moveTo(state, wordForward(state)));
    case "b":
      return none(moveTo(state, wordBackward(state)));
    case "e":
      return none(moveTo(state, wordEnd(state)));
    case "Ctrl-u":
      return none(moveTo(state, { ...cursor, row: cursor.row - half }));
    case "Ctrl-d":
      return none(moveTo(state, { ...cursor, row: cursor.row + half }));
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
