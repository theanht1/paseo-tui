import { useKeyboard } from "@opentui/react";
import { useEffect, useRef } from "react";
import {
  type Action,
  type Binding,
  type Context,
  dispatch,
  type Mode,
  type Stroke,
} from "./keymap.js";
export function useKeymap(
  mode: Mode,
  context: Context,
  onMode: (mode: Mode) => void,
  onAction: (action: Action) => void,
  enabled = true,
  prefix?: Stroke,
  bindings?: readonly Binding[],
) {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    if (mode.kind !== "prefix") return;
    const back: Mode =
      mode.returnTo === "insert"
        ? { kind: "insert" }
        : { kind: "normal", pending: "" };
    const timer = setTimeout(() => {
      modeRef.current = back;
      onMode(back);
    }, 1500);
    return () => clearTimeout(timer);
  }, [mode, onMode]);
  useKeyboard((event) => {
    if (!enabled || (event.ctrl && event.name === "c")) return;
    const current = modeRef.current;
    const result = dispatch(current, context, event, prefix, bindings);
    if (
      current.kind === "prefix" ||
      current.kind === "search" ||
      result.action ||
      result.mode.kind !== current.kind ||
      (result.mode.kind === "normal" && result.mode.pending)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
    modeRef.current = result.mode;
    onMode(result.mode);
    if (result.action) onAction(result.action);
  });
}
