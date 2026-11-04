import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { useKeyboard } from "@opentui/react";
import { useContext, useRef, useState } from "react";
import type { TimelineStore } from "./App.js";
import { foregroundProp, ThemeContext } from "./render/theme.js";

export function permissionLines(request: AgentPermissionRequest): string[] {
  const lines = [`${request.title ?? request.name} [${request.kind}]`];
  if (request.description) lines.push(request.description);
  if (request.input) {
    const input = JSON.stringify(request.input, null, 2).split("\n");
    if (input.length > 6) lines.push(...input.slice(0, 5), "…");
    else lines.push(...input);
  }
  const actions = request.actions ?? [];
  for (const [index, action] of actions.slice(0, 9).entries())
    lines.push(`${index + 1}. ${action.label}`);
  if (actions.length > 0) lines.push("1–9 choose · Esc defer");
  else if (request.kind === "question")
    lines.push("answer in the app · n deny · Esc defer");
  else lines.push("y allow · n deny · Esc defer");
  return lines.flatMap((line) => line.split(/\r?\n/));
}

function visiblePermissionLines(
  request: AgentPermissionRequest,
  height: number,
) {
  const lines = permissionLines(request);
  const controlsCount = Math.min(9, request.actions?.length ?? 0) + 1;
  const controls = lines.slice(-controlsCount);
  const content = lines.slice(0, -controlsCount);
  const contentRows = Math.max(1, height - 2 - controlsCount);
  if (content.length > contentRows && contentRows > 1)
    content.splice(contentRows - 1, content.length, "…");
  return [...content.slice(0, contentRows), ...controls];
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
  const [pending, setPending] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);
  async function respond(response: AgentPermissionResponse) {
    if (inFlight.current) return;
    setPending(true);
    const operation = store.respond(request.id, response);
    inFlight.current = operation;
    await operation;
    inFlight.current = null;
    setPending(false);
  }
  useKeyboard((key) => {
    if (!focused || pending) return;
    const input = key.sequence;
    if (key.name === "escape") {
      onDefer();
      return;
    }
    const actions = request.actions ?? [];
    if (actions.length > 0) {
      if (!/^[1-9]$/.test(input)) return;
      const action = actions[Number(input) - 1];
      if (action)
        void respond({
          behavior: action.behavior,
          selectedActionId: action.id,
        });
    } else if (input === "n") void respond({ behavior: "deny" });
    else if (input === "y" && request.kind !== "question")
      void respond({ behavior: "allow" });
  });
  const lines = visiblePermissionLines(request, height);
  if (pending) lines[lines.length - 1] = "Responding…";
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={foregroundProp(context.theme.warn)}
      height={height}
      overflow="hidden"
      flexShrink={0}
    >
      {Array.from(lines.entries()).map(([index, line]) => {
        const action = request.actions?.find(
          (_, i) => line === `${i + 1}. ${request.actions?.[i].label}`,
        );
        return (
          <text
            fg={foregroundProp(context.theme.fg)}
            key={`${index}:${line}`}
            wrapMode="none"
            onMouseDown={() => {
              if (action)
                void respond({
                  behavior: action.behavior,
                  selectedActionId: action.id,
                });
            }}
          >
            {line}
          </text>
        );
      })}
    </box>
  );
}
