import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import type { Stroke } from "../input/keymap.js";
import {
  createQuestionStore,
  type QuestionForm,
  questionClick,
  questionForm,
  questionKey,
  questionRows,
} from "./question-form.js";

const input = {
  questions: [
    {
      question: "Which database should we use?",
      header: "Database",
      multiSelect: false,
      allowOther: true,
      options: [
        { label: "Postgres", description: "Relational" },
        { label: "SQLite", description: "Embedded" },
      ],
    },
    {
      question: "Which features do you want?",
      header: "Features",
      multiSelect: true,
      options: [{ label: "Auth" }, { label: "Billing" }, { label: "Search" }],
    },
  ],
};
const request: AgentPermissionRequest = {
  id: "ask",
  provider: "claude",
  name: "AskUserQuestion",
  kind: "question",
  input,
};

function key(name: string, extra: Partial<Stroke> = {}): Stroke {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name.length === 1 ? name : "",
    ...extra,
  };
}
function form(): QuestionForm {
  const parsed = questionForm(request);
  if (!parsed) throw Error("question did not parse");
  return parsed;
}
function press(start: QuestionForm, ...names: (string | Stroke)[]) {
  let current = start;
  for (const name of names) {
    const step = questionKey(
      current,
      typeof name === "string" ? key(name) : name,
    );
    if (step.kind === "respond") return step.response;
    current = step.form;
  }
  return current;
}
function formAfter(start: QuestionForm, ...names: (string | Stroke)[]) {
  const result = press(start, ...names);
  if (!("questions" in result)) throw Error("form responded unexpectedly");
  return result;
}

describe("questionForm", () => {
  it("parses only well-formed question requests", () => {
    expect(questionForm({ ...request, kind: "tool" })).toBeNull();
    expect(questionForm({ ...request, input: { questions: [] } })).toBeNull();
    expect(
      questionForm({ ...request, input: { questions: [{ header: "x" }] } }),
    ).toBeNull();
    expect(form().questions.map((q) => q.allowOther)).toEqual([true, false]);
  });

  it("steps through questions with keys and submits answers keyed by header", () => {
    const response = press(
      form(),
      "j",
      "return",
      "space",
      "down",
      "down",
      "space",
      "return",
    );
    expect(response).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { Database: "SQLite", Features: "Auth, Search" },
      },
    });
  });

  it("picks with number keys, toggles multi-select numbers, and moves between questions with Tab", () => {
    const second = formAfter(form(), "1");
    expect(second.index).toBe(1);
    const toggled = formAfter(second, "2", "3", "2");
    expect(toggled.selections[1]).toEqual([2]);
    const back = formAfter(toggled, key("tab", { shift: true }));
    expect(back.index).toBe(0);
    expect(back.selections[0]).toEqual([0]);
    expect(formAfter(back, "tab").index).toBe(1);
  });

  it("types shortcut letters into Other, replaces a single choice, and confirms with Enter", () => {
    const editing = formAfter(form(), "1", "h", "j", "j", "return");
    expect(editing.editing).toBe(true);
    const typed = formAfter(
      editing,
      "q",
      "j",
      key("space", { sequence: " " }),
      "x",
      "backspace",
      "k",
    );
    expect(typed.other[0]).toBe("qj k");
    expect(typed.selections[0]).toEqual([]);
    expect(typed.index).toBe(0);
    const response = press(typed, "return", "2", "return");
    expect(response).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { Database: "qj k", Features: "Billing" },
      },
    });
  });

  it("leaves Other editing with Esc and cancels the question with a second Esc", () => {
    const editing = formAfter(form(), "3");
    expect(editing.editing).toBe(true);
    const left = formAfter(editing, "a", "escape");
    expect(left.editing).toBe(false);
    expect(left.other[0]).toBe("a");
    expect(press(left, "escape")).toEqual({
      behavior: "deny",
      message: "Dismissed by user",
    });
  });

  it("leaves Other editing with Ctrl-C and keeps the typed answer", () => {
    const left = formAfter(form(), "3", "a", key("c", { ctrl: true }));
    expect(left.editing).toBe(false);
    expect(left.other[0]).toBe("a");
  });

  it("jumps to the first unanswered question instead of submitting", () => {
    const last = formAfter(form(), "tab", "1");
    const step = questionKey(last, key("return"));
    expect(step.kind === "form" && step.form.index).toBe(0);
  });

  it("selects, edits, navigates, submits, and cancels from mouse targets", () => {
    let current = form();
    const click = (target: Parameters<typeof questionClick>[1]) => {
      const step = questionClick(current, target);
      if (step.kind === "respond") return step.response;
      current = step.form;
      return null;
    };
    click({ kind: "option", index: 1 });
    expect(current.selections[0]).toEqual([1]);
    expect(current.index).toBe(0);
    click({ kind: "submit" });
    expect(current.index).toBe(1);
    click({ kind: "option", index: 0 });
    click({ kind: "option", index: 2 });
    click({ kind: "option", index: 0 });
    click({ kind: "question", index: 0 });
    click({ kind: "other" });
    expect(current.editing).toBe(true);
    expect(click({ kind: "submit" })).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { Database: "SQLite", Features: "Search" },
      },
    });
    expect(click({ kind: "cancel" })).toEqual({
      behavior: "deny",
      message: "Dismissed by user",
    });
  });

  it("renders tabs, options, Other, and a submit row, windowing options around the cursor", () => {
    const rows = questionRows(form(), 20);
    expect(rows.map((row) => row.kind)).toEqual([
      "tabs",
      "question",
      "option",
      "option",
      "other",
      "hint",
      "buttons",
    ]);
    const many = questionForm({
      ...request,
      input: {
        questions: [
          {
            question: "Pick",
            header: "Pick",
            options: Array.from({ length: 9 }, (_, i) => ({ label: `o${i}` })),
          },
        ],
      },
    });
    if (!many) throw Error("question did not parse");
    const windowed = questionRows(formAfter(many, "8"), 8);
    expect(windowed).toHaveLength(8);
    const options = windowed.flatMap((row) =>
      row.kind === "option" ? [row.index] : [],
    );
    expect(options).toContain(7);
    expect(options).not.toContain(0);
  });
});

describe("question option navigation", () => {
  it("jumps with G, gg, Ctrl-d/u and Home/End, and a stray key cancels a pending g", () => {
    const features = formAfter(form(), "tab");
    expect(formAfter(features, key("G", { shift: true })).cursor).toBe(2);
    expect(formAfter(features, "g", "g").cursor).toBe(0);
    expect(formAfter(features, "end").cursor).toBe(2);
    expect(formAfter(features, "end", "home").cursor).toBe(0);
    expect(formAfter(features, key("d", { ctrl: true })).cursor).toBe(2);
    expect(formAfter(features, "end", key("u", { ctrl: true })).cursor).toBe(0);
    expect(formAfter(features, "j", "g", "x", "g").cursor).toBe(1);
    expect(formAfter(features, "j", "g", "j", "g").cursor).toBe(2);
  });
});

describe("createQuestionStore", () => {
  it("responds once while a reply is pending and pastes into Other", async () => {
    const responses: unknown[] = [];
    let finish: () => void = () => {};
    const store = createQuestionStore(form(), (response) => {
      responses.push(response);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    store.key(key("3"));
    store.paste("from\nclipboard");
    expect(store.getSnapshot().form.other[0]).toBe("from clipboard");
    store.key(key("return"));
    store.key(key("1"));
    store.key(key("return"));
    store.key(key("return"));
    expect(store.getSnapshot().pending).toBe(true);
    expect(responses).toEqual([
      {
        behavior: "allow",
        updatedInput: {
          ...input,
          answers: { Database: "from clipboard", Features: "Auth" },
        },
      },
    ]);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().pending).toBe(false);
  });
});
