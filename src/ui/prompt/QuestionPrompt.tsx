import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { TextAttributes } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useContext, useState } from "react";
import type { TimelineStore } from "../../state/timeline-store.js";
import { useKeyOwner } from "../input/key-router.js";
import { foregroundProp, ThemeContext } from "../render/theme.js";
import { useStore } from "../use-store.js";
import {
  createQuestionStore,
  type QuestionForm,
  type QuestionRow,
  questionRows,
} from "./question-form.js";

export function QuestionPrompt({
  request,
  form,
  store,
  focused,
  maxRows,
}: {
  request: AgentPermissionRequest;
  form: QuestionForm;
  store: TimelineStore;
  focused: boolean;
  maxRows: number;
}) {
  const [question] = useState(() =>
    createQuestionStore(form, (response) =>
      store.respond(request.id, response),
    ),
  );
  const { form: state, pending } = useStore(question);
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  useKeyOwner(focused && state.editing, (event) => {
    if (!(event.ctrl && event.name === "c")) return false;
    question.key(event);
    return true;
  });
  useKeyboard((event) => {
    if (!focused) return;
    event.preventDefault();
    event.stopPropagation();
    question.key(event);
  });
  usePaste((event) => {
    if (!focused) return;
    event.preventDefault();
    event.stopPropagation();
    question.paste(new TextDecoder().decode(event.bytes));
  });
  const rows = questionRows(state, maxRows);
  function render(row: QuestionRow, index: number) {
    switch (row.kind) {
      case "tabs":
        return (
          <box key={index} flexDirection="row" gap={2} flexShrink={0}>
            {row.tabs.map((tab) => (
              <text
                key={tab.index}
                id={`question-tab:${tab.index}`}
                fg={foregroundProp(tab.active ? theme.accent : theme.muted)}
                attributes={tab.active ? TextAttributes.BOLD : 0}
                onMouseDown={() =>
                  question.click({ kind: "question", index: tab.index })
                }
              >
                {`${tab.answered ? "✓" : "○"} ${tab.label}`}
              </text>
            ))}
          </box>
        );
      case "question":
        return (
          <text
            key={index}
            fg={foregroundProp(theme.fg)}
            attributes={TextAttributes.BOLD}
          >
            {row.text}
          </text>
        );
      case "option": {
        const mark = row.multiSelect
          ? row.checked
            ? "[x] "
            : "[ ] "
          : row.checked
            ? "● "
            : "";
        return (
          <text
            key={index}
            id={`question-option:${row.index}`}
            wrapMode="none"
            fg={foregroundProp(row.cursor ? theme.accent : theme.fg)}
            onMouseDown={() =>
              question.click({ kind: "option", index: row.index })
            }
          >
            {`${row.cursor ? "›" : " "} ${row.index + 1}. ${mark}${row.label}`}
            {row.description ? (
              <span
                fg={foregroundProp(theme.muted)}
              >{` — ${row.description}`}</span>
            ) : null}
          </text>
        );
      }
      case "other":
        return (
          <text
            key={index}
            id="question-other"
            wrapMode="none"
            fg={foregroundProp(row.cursor ? theme.accent : theme.fg)}
            onMouseDown={() => question.click({ kind: "other" })}
          >
            {`${row.cursor ? "›" : " "} ${row.number}. ${row.label}: ${row.text}`}
            {row.editing ? (
              "▌"
            ) : row.text ? (
              ""
            ) : (
              <span fg={foregroundProp(theme.faint)}>type an answer</span>
            )}
          </text>
        );
      case "hint":
        return (
          <text key={index} wrapMode="none" fg={foregroundProp(theme.muted)}>
            {row.text}
          </text>
        );
      case "buttons":
        if (pending)
          return (
            <text key={index} fg={foregroundProp(theme.muted)}>
              Responding…
            </text>
          );
        return (
          <box key={index} flexDirection="row" gap={3} flexShrink={0}>
            <text
              id="question-submit"
              fg={foregroundProp(row.canSubmit ? theme.accent : theme.faint)}
              attributes={TextAttributes.BOLD}
              onMouseDown={() => question.click({ kind: "submit" })}
            >
              [ Submit ]
            </text>
            <text
              id="question-cancel"
              fg={foregroundProp(theme.muted)}
              onMouseDown={() => question.click({ kind: "cancel" })}
            >
              [ Cancel ]
            </text>
          </box>
        );
    }
  }
  return (
    <box
      id="question-prompt"
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={foregroundProp(focused ? theme.warn : theme.faint)}
      title="Question"
      paddingX={1}
      flexShrink={0}
      overflow="hidden"
    >
      {rows.map(render)}
    </box>
  );
}
