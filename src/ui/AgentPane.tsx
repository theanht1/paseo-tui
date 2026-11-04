import type { PaseoAgent } from "@getpaseo/client";
import {
  type BaseRenderable,
  type BoxRenderable,
  TextareaRenderable,
} from "@opentui/core";
import {
  type Ref,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { TimelineStore } from "./App.js";
import { agentName } from "./agent-display.js";
import { nextMode } from "./agent-modes.js";
import type { Action, Mode, Stroke } from "./input/keymap.js";
import { PermissionPrompt, permissionLines } from "./PermissionPrompt.js";
import { PromptInput } from "./PromptInput.js";
import { type Focus, watchPermissions } from "./permission-focus.js";
import { ThemeContext } from "./render/theme.js";
import {
  type TimelineControls,
  TimelineView,
} from "./timeline/TimelineView.js";
import { useStore } from "./use-store.js";

function textarea(node: BaseRenderable): TextareaRenderable | undefined {
  if (node instanceof TextareaRenderable) return node;
  for (const child of node.getChildren()) {
    const found = textarea(child);
    if (found) return found;
  }
  return undefined;
}
export function AgentPane({
  store,
  agent,
  focused,
  focus,
  mode,
  setFocus,
  setMode,
  controls,
  height,
  prefix,
  onSearchStatus,
}: {
  store: TimelineStore;
  agent: PaseoAgent;
  focused: boolean;
  focus: Focus;
  mode: Mode;
  setFocus: (focus: Focus | ((current: Focus) => Focus)) => void;
  setMode: (mode: Mode) => void;
  controls: Ref<TimelineControls>;
  height: number;
  prefix: Stroke;
  onSearchStatus: (status: string) => void;
}) {
  const context = useContext(ThemeContext);
  if (!context) throw Error("ThemeContext required");
  const snapshot = useStore(store),
    timeline = useRef<TimelineControls>(null),
    box = useRef<BoxRenderable>(null);
  const stopping = useRef(false);
  const [stopStatus, setStopStatus] = useState("");
  useEffect(() => {
    if (focused)
      return watchPermissions(store, (transition) => setFocus(transition));
  }, [store, focused, setFocus]);
  async function stop() {
    if (snapshot.turn.kind !== "running" || stopping.current) return;
    stopping.current = true;
    setStopStatus("Stopping…");
    await store.cancel();
    stopping.current = false;
    setStopStatus(store.getSnapshot().lastActionError ? "" : "Stop requested.");
  }
  useImperativeHandle(controls, () => ({
    act(action: Action) {
      if (action.type === "agent.cycleMode") {
        const id = nextMode(agent);
        if (id) void store.setMode(id);
        return;
      }
      if (action.type === "stop") {
        void stop();
        return;
      }
      if (action.type === "prefix.literal") {
        if (box.current) textarea(box.current)?.insertText(prefix.sequence);
        return;
      }
      timeline.current?.act(action);
    },
  }));
  const permission =
    snapshot.pendingPermissions.find(
      (r) => focus.pane === "permission" && r.id === focus.requestId,
    ) ?? snapshot.pendingPermissions[0];
  const permissionHeight = permission
    ? Math.min(permissionLines(permission).length + 2, Math.max(5, height - 3))
    : 0;
  return (
    <box ref={box} flexDirection="column" flexGrow={1} minHeight={0}>
      <TimelineView
        store={store}
        agent={agent}
        focused={focused && focus.pane === "timeline" && mode.kind === "normal"}
        controls={timeline}
        onSearchStatus={onSearchStatus}
      />
      {permission ? (
        <PermissionPrompt
          key={permission.id}
          request={permission}
          store={store}
          focused={focused && focus.pane === "permission"}
          height={permissionHeight}
          onDefer={() => setFocus({ pane: "timeline" })}
        />
      ) : null}
      <PromptInput
        store={store}
        focused={
          focused &&
          (mode.kind === "insert" ||
            (mode.kind === "prefix" && mode.returnTo === "insert")) &&
          focus.pane === "prompt"
        }
        name={agentName(agent)}
        onClose={() => {
          setMode({ kind: "normal", pending: "" });
          setFocus((current) =>
            current.pane === "prompt" ? { pane: "timeline" } : current,
          );
        }}
      />
      {stopStatus ? <text height={1}>{stopStatus}</text> : null}
    </box>
  );
}
