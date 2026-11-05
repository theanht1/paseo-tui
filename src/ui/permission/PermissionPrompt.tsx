import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { useKeyboard, usePaste } from "@opentui/react";
import { useContext, useRef, useState } from "react";
import type { TimelineStore } from "../../state/timeline-store.js";
import { useKeyOwner } from "../input/key-router.js";
import { Markdown } from "../render/markdown.js";
import {
  foregroundProp,
  scrollbarOptions,
  ThemeContext,
} from "../render/theme.js";
import { opensSteer, STEER_HINT, steerKey, steerPaste } from "./steer.js";

/** Plan text of a plan-approval request, as the daemon provides it. */
export function planText(request: AgentPermissionRequest): string | null {
  if (request.kind !== "plan") return null;
  const fromMetadata = request.metadata?.planText;
  if (typeof fromMetadata === "string") return fromMetadata;
  const fromInput = request.input?.plan;
  return typeof fromInput === "string" ? fromInput : null;
}

function hint(request: AgentPermissionRequest): string {
  const actions = request.actions ?? [];
  if (request.kind === "plan" && actions.length === 0)
    return `y implement · n reject · ↑↓ scroll · ${STEER_HINT} · Esc defer`;
  if (actions.length > 0)
    return `1–9 choose${request.kind === "plan" ? " · ↑↓ scroll" : ""} · ${STEER_HINT} · Esc defer`;
  if (request.kind === "question")
    return `answer in the app · n deny · ${STEER_HINT} · Esc defer`;
  return `y allow · n deny · ${STEER_HINT} · Esc defer`;
}

interface PermissionView {
  /** Title, description and (for non-plans) the tool input. */
  content: string[];
  plan: string | null;
  controls: string[];
}
export function permissionView(
  request: AgentPermissionRequest,
): PermissionView {
  const plan = planText(request);
  const content = [
    plan !== null
      ? (request.title ?? "Plan")
      : `${request.title ?? request.name} [${request.kind}]`,
  ];
  if (request.description) content.push(request.description);
  if (request.input && plan === null) {
    const input = JSON.stringify(request.input, null, 2).split("\n");
    if (input.length > 6) content.push(...input.slice(0, 5), "…");
    else content.push(...input);
  }
  const actions = request.actions ?? [];
  const controls = actions
    .slice(0, 9)
    .map((action, index) => `${index + 1}. ${action.label}`);
  controls.push(hint(request));
  return {
    content: content.flatMap((line) => line.split(/\r?\n/)),
    plan,
    controls,
  };
}

/** Rows the card wants before the pane caps it; used to size the card. */
export function permissionLines(request: AgentPermissionRequest): string[] {
  const view = permissionView(request);
  return [
    ...view.content,
    // Rendered markdown adds spacing around headings and lists.
    ...(view.plan === null ? [] : [...view.plan.split(/\r?\n/), "", ""]),
    ...view.controls,
  ];
}

function visibleContent(view: PermissionView, height: number) {
  const contentRows = Math.max(1, height - 2 - view.controls.length);
  const content = [...view.content];
  const room = view.plan === null ? contentRows : Math.max(1, contentRows - 1);
  if (content.length > room && room > 1)
    content.splice(room - 1, content.length, "…");
  return {
    content: content.slice(0, room),
    planRows: Math.max(1, contentRows - Math.min(room, content.length)),
  };
}

interface PermissionPromptProps {
  request: AgentPermissionRequest;
  store: TimelineStore;
  focused: boolean;
  height: number;
  onDefer(): void;
}

export function PermissionPrompt({
  request,
  store,
  focused,
  height,
  onDefer,
}: PermissionPromptProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [steer, setSteer] = useState<string | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  async function run(label: string, operation: () => Promise<void>) {
    if (inFlight.current) return;
    setPending(label);
    const started = operation();
    inFlight.current = started;
    await started;
    inFlight.current = null;
    setPending(null);
  }
  function respond(response: AgentPermissionResponse) {
    void run("Responding…", () => store.respond(request.id, response));
  }
  useKeyOwner(focused && steer !== null, (event) => {
    if (!(event.ctrl && event.name === "c")) return false;
    setSteer(null);
    return true;
  });
  usePaste((event) => {
    if (!focused || steer === null) return;
    event.preventDefault();
    event.stopPropagation();
    setSteer(steerPaste(steer, new TextDecoder().decode(event.bytes)));
  });
  useKeyboard((key) => {
    if (!focused || pending) return;
    if (steer !== null) {
      const step = steerKey(steer, key);
      if (step.kind === "edit") setSteer(step.text);
      else if (step.kind === "close") setSteer(null);
      else {
        setSteer(null);
        void run("Sending…", () => store.steer(step.text));
      }
      return;
    }
    const input = key.sequence;
    if (key.name === "escape") {
      onDefer();
      return;
    }
    if (opensSteer(key)) {
      setSteer("");
      return;
    }
    const actions = request.actions ?? [];
    if (actions.length > 0) {
      if (!/^[1-9]$/.test(input)) return;
      const action = actions[Number(input) - 1];
      if (action)
        respond({ behavior: action.behavior, selectedActionId: action.id });
    } else if (input === "n") respond({ behavior: "deny" });
    else if (input === "y" && request.kind !== "question")
      respond({ behavior: "allow" });
  });
  const view = permissionView(request);
  const { content, planRows } = visibleContent(view, height);
  const controls = [...view.controls];
  if (pending) controls[controls.length - 1] = pending;
  else if (steer !== null)
    controls[controls.length - 1] = `Message › ${steer}▌`;
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const { theme } = context;
  function line(text: string, index: number, onPick?: () => void) {
    return (
      <text
        fg={foregroundProp(theme.fg)}
        key={`${index}:${text}`}
        wrapMode="none"
        flexShrink={0}
        onMouseDown={onPick}
      >
        {text}
      </text>
    );
  }
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={foregroundProp(theme.warn)}
      title={steer !== null ? "Enter send · Esc back" : undefined}
      height={height}
      overflow="hidden"
      flexShrink={0}
    >
      {content.map((text, index) => line(text, index))}
      {view.plan !== null ? (
        <scrollbox
          height={planRows}
          flexShrink={0}
          focused={focused && steer === null}
          scrollX={false}
          scrollbarOptions={scrollbarOptions(theme)}
          horizontalScrollbarOptions={{ visible: false }}
        >
          <box flexShrink={0} flexDirection="column">
            <Markdown text={view.plan} />
          </box>
        </scrollbox>
      ) : null}
      {controls.map((text, index) => {
        const action = request.actions?.[index];
        return line(
          text,
          content.length + index,
          action && index < 9
            ? () =>
                respond({
                  behavior: action.behavior,
                  selectedActionId: action.id,
                })
            : undefined,
        );
      })}
    </box>
  );
}
