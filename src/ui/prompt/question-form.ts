import type {
  AgentMetadata,
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { createEmitter } from "../../state/emitter.js";
import type { Stroke } from "../input/keymap.js";
import { listKey } from "../input/list-keys.js";
import { STEER_HINT } from "../permission/steer.js";

export interface QuestionOption {
  label: string;
  description: string | null;
}
export interface Question {
  question: string;
  header: string;
  options: readonly QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
}
export interface QuestionForm {
  input: AgentMetadata;
  questions: readonly Question[];
  index: number;
  cursor: number;
  selections: readonly (readonly number[])[];
  other: readonly string[];
  editing: boolean;
  /** A `g` was pressed and `gg` would jump to the first option. */
  pendingG: boolean;
}
export type QuestionStep =
  | { kind: "form"; form: QuestionForm }
  | { kind: "respond"; response: AgentPermissionResponse };
export type QuestionTarget =
  | { kind: "question"; index: number }
  | { kind: "option"; index: number }
  | { kind: "other" }
  | { kind: "submit" }
  | { kind: "cancel" };
export type QuestionRow =
  | {
      kind: "tabs";
      tabs: readonly {
        index: number;
        label: string;
        active: boolean;
        answered: boolean;
      }[];
    }
  | { kind: "question"; text: string }
  | {
      kind: "option";
      index: number;
      label: string;
      description: string | null;
      checked: boolean;
      cursor: boolean;
      multiSelect: boolean;
    }
  | {
      kind: "other";
      number: number;
      label: string;
      text: string;
      cursor: boolean;
      editing: boolean;
    }
  | { kind: "hint"; text: string }
  | { kind: "buttons"; canSubmit: boolean };

const DISMISSED: AgentPermissionResponse = {
  behavior: "deny",
  message: "Dismissed by user",
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function parseQuestion(value: unknown): Question | null {
  const item = record(value);
  if (
    !item ||
    typeof item.question !== "string" ||
    typeof item.header !== "string"
  )
    return null;
  if (!Array.isArray(item.options)) return null;
  const options: QuestionOption[] = [];
  for (const raw of item.options) {
    const option = record(raw);
    if (!option || typeof option.label !== "string") return null;
    options.push({
      label: option.label,
      description:
        typeof option.description === "string" && option.description.trim()
          ? option.description
          : null,
    });
  }
  return {
    question: item.question,
    header: item.header,
    options,
    multiSelect: item.multiSelect === true,
    allowOther: item.allowOther === true || item.isOther === true,
  };
}

export function questionForm(
  request: AgentPermissionRequest,
): QuestionForm | null {
  if (request.kind !== "question" || !request.input) return null;
  const raw = request.input.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions: Question[] = [];
  for (const item of raw) {
    const question = parseQuestion(item);
    if (!question) return null;
    questions.push(question);
  }
  return {
    input: request.input,
    questions,
    index: 0,
    cursor: 0,
    selections: questions.map(() => []),
    other: questions.map(() => ""),
    editing: false,
    pendingG: false,
  };
}

function hasText(question: Question) {
  return question.options.length === 0 || question.allowOther;
}
function current(form: QuestionForm): Question {
  const question = form.questions[form.index];
  if (!question) throw Error(`Question ${form.index} is out of range`);
  return question;
}
function rowCount(form: QuestionForm) {
  const question = current(form);
  return question.options.length + (hasText(question) ? 1 : 0);
}
function answered(form: QuestionForm, index: number) {
  return (
    (form.selections[index]?.length ?? 0) > 0 ||
    (form.other[index]?.trim() ?? "") !== ""
  );
}
export function canSubmitQuestions(form: QuestionForm) {
  return form.questions.every((_, index) => answered(form, index));
}
function answers(form: QuestionForm): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [index, question] of form.questions.entries()) {
    const picked = (form.selections[index] ?? []).flatMap(
      (option) => question.options[option]?.label ?? [],
    );
    const text = form.other[index]?.trim() ?? "";
    if (text && !question.multiSelect) result[question.header] = text;
    else if (text || picked.length > 0)
      result[question.header] = [...picked, ...(text ? [text] : [])].join(", ");
  }
  return result;
}
function replace<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, i) => (i === index ? value : item));
}
function goTo(form: QuestionForm, index: number): QuestionForm {
  const target = Math.max(0, Math.min(form.questions.length - 1, index));
  return {
    ...form,
    index: target,
    cursor: form.selections[target]?.[0] ?? 0,
    editing: false,
  };
}
function choose(form: QuestionForm, option: number): QuestionForm {
  const question = current(form);
  const selected = form.selections[form.index] ?? [];
  if (question.multiSelect) {
    const next = selected.includes(option)
      ? selected.filter((item) => item !== option)
      : [...selected, option].sort((a, b) => a - b);
    return {
      ...form,
      cursor: option,
      selections: replace(form.selections, form.index, next),
    };
  }
  return {
    ...form,
    cursor: option,
    selections: replace(form.selections, form.index, [option]),
    other: replace(form.other, form.index, ""),
  };
}
function editOther(form: QuestionForm): QuestionForm {
  return { ...form, cursor: current(form).options.length, editing: true };
}
function typeText(form: QuestionForm, text: string): QuestionForm {
  const value = (form.other[form.index] ?? "") + text;
  return {
    ...form,
    other: replace(form.other, form.index, value),
    selections: current(form).multiSelect
      ? form.selections
      : replace(form.selections, form.index, []),
  };
}
function submit(form: QuestionForm): QuestionStep {
  const missing = form.questions.findIndex(
    (_, index) => !answered(form, index),
  );
  if (missing >= 0) return { kind: "form", form: goTo(form, missing) };
  return {
    kind: "respond",
    response: {
      behavior: "allow",
      updatedInput: { ...form.input, answers: answers(form) },
    },
  };
}
function advance(form: QuestionForm): QuestionStep {
  const settled = { ...form, editing: false };
  if (!answered(settled, settled.index)) return { kind: "form", form: settled };
  if (settled.index < settled.questions.length - 1)
    return { kind: "form", form: goTo(settled, settled.index + 1) };
  return submit(settled);
}
function stay(form: QuestionForm): QuestionStep {
  return { kind: "form", form };
}

function editingKey(form: QuestionForm, key: Stroke): QuestionStep {
  if (key.name === "escape" || (key.ctrl && key.name === "c"))
    return stay({ ...form, editing: false });
  if (key.name === "return" || key.name === "enter") return advance(form);
  if (key.name === "backspace")
    return stay({
      ...form,
      other: replace(
        form.other,
        form.index,
        (form.other[form.index] ?? "").slice(0, -1),
      ),
    });
  if (
    key.ctrl ||
    key.meta ||
    !key.sequence ||
    [...key.sequence].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    return stay(form);
  return stay(typeText(form, key.sequence));
}

const OPTION_PAGE = 8;
export function questionKey(form: QuestionForm, key: Stroke): QuestionStep {
  if (form.editing) return editingKey(form, key);
  const rows = rowCount(form);
  const moved = listKey(
    key,
    { cursor: form.cursor, pendingG: form.pendingG },
    rows,
    OPTION_PAGE,
  );
  if (moved !== "pass") return stay({ ...form, ...moved });
  if (form.pendingG) return questionKey({ ...form, pendingG: false }, key);
  const question = current(form);
  if (key.name === "escape") return { kind: "respond", response: DISMISSED };
  if (key.name === "tab")
    return stay(goTo(form, form.index + (key.shift ? -1 : 1)));
  if (key.name === "right" || key.name === "l")
    return stay(goTo(form, form.index + 1));
  if (key.name === "left" || key.name === "h")
    return stay(goTo(form, form.index - 1));
  const onOther = form.cursor >= question.options.length;
  if (/^[1-9]$/.test(key.sequence) && !key.ctrl && !key.meta) {
    const option = Number(key.sequence) - 1;
    if (option < question.options.length) {
      const chosen = choose(form, option);
      if (question.multiSelect || form.index === form.questions.length - 1)
        return stay(chosen);
      return advance(chosen);
    }
    if (option === question.options.length && hasText(question))
      return stay(editOther(form));
    return stay(form);
  }
  if (key.name === "space")
    return stay(onOther ? editOther(form) : choose(form, form.cursor));
  if (key.name === "return" || key.name === "enter") {
    if (onOther) return stay(editOther(form));
    return advance(question.multiSelect ? form : choose(form, form.cursor));
  }
  return stay(form);
}

export function questionClick(
  form: QuestionForm,
  target: QuestionTarget,
): QuestionStep {
  switch (target.kind) {
    case "question":
      return stay(goTo(form, target.index));
    case "option":
      return stay(choose({ ...form, editing: false }, target.index));
    case "other":
      return stay(editOther(form));
    case "submit":
      return submit({ ...form, editing: false });
    case "cancel":
      return { kind: "respond", response: DISMISSED };
  }
}

export function questionRows(
  form: QuestionForm,
  maxRows: number,
): QuestionRow[] {
  const question = current(form);
  const head: QuestionRow[] = [
    {
      kind: "tabs",
      tabs: form.questions.map((item, index) => ({
        index,
        label: item.header,
        active: index === form.index,
        answered: answered(form, index),
      })),
    },
    ...question.question
      .split(/\r?\n/)
      .map((text): QuestionRow => ({ kind: "question", text })),
  ];
  if (question.multiSelect)
    head.push({ kind: "hint", text: "Select all that apply" });
  const options: QuestionRow[] = question.options.map((option, index) => ({
    kind: "option",
    index,
    label: option.label,
    description: option.description,
    checked: form.selections[form.index]?.includes(index) ?? false,
    cursor: form.cursor === index,
    multiSelect: question.multiSelect,
  }));
  if (hasText(question))
    options.push({
      kind: "other",
      number: question.options.length + 1,
      label: question.options.length > 0 ? "Other" : "Answer",
      text: form.other[form.index] ?? "",
      cursor: form.cursor === question.options.length,
      editing: form.editing,
    });
  const tail: QuestionRow[] = [
    {
      kind: "hint",
      text: form.editing
        ? "Type your answer · Enter confirm · Esc back to options"
        : `↑↓/jk gg/G move · 1-9 pick${question.multiSelect ? " · Space toggle" : ""} · Tab/←→ question · Enter ${form.index === form.questions.length - 1 ? "submit" : "next"} · ${STEER_HINT} · Esc cancel`,
    },
    { kind: "buttons", canSubmit: canSubmitQuestions(form) },
  ];
  const room = Math.max(1, maxRows - head.length - tail.length);
  const start = Math.max(
    0,
    Math.min(options.length - room, form.cursor - Math.floor(room / 2)),
  );
  return [...head, ...options.slice(start, start + room), ...tail];
}

export function createQuestionStore(
  initial: QuestionForm,
  respond: (response: AgentPermissionResponse) => Promise<void>,
) {
  const emitter = createEmitter();
  let snapshot = { form: initial, pending: false };
  function publish(next: typeof snapshot) {
    snapshot = next;
    emitter.notify();
  }
  function apply(step: QuestionStep) {
    if (step.kind === "form") {
      publish({ ...snapshot, form: step.form });
      return;
    }
    publish({ ...snapshot, pending: true });
    void respond(step.response).finally(() =>
      publish({ ...snapshot, pending: false }),
    );
  }
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    key(key: Stroke) {
      if (!snapshot.pending) apply(questionKey(snapshot.form, key));
    },
    click(target: QuestionTarget) {
      if (!snapshot.pending) apply(questionClick(snapshot.form, target));
    },
    paste(text: string) {
      if (snapshot.pending || !snapshot.form.editing) return;
      apply({
        kind: "form",
        form: typeText(snapshot.form, text.replace(/\r?\n/g, " ")),
      });
    },
  };
}
