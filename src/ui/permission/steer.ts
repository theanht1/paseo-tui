import type { Stroke } from "../input/keymap.js";

/**
 * Steering answers a pending permission, plan or question with a message instead
 * of a choice. The daemon denies the blocked request and the agent reads the
 * message in the same turn (see `AgentPort.steer`).
 */
export type SteerStep =
  | { kind: "edit"; text: string }
  | { kind: "send"; text: string }
  | { kind: "close" };

export const STEER_HINT = "m message";

export function opensSteer(key: Stroke): boolean {
  return key.sequence === "m" && !key.ctrl && !key.meta;
}

function printable(sequence: string): boolean {
  return (
    sequence.length > 0 &&
    ![...sequence].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  );
}

export function steerKey(text: string, key: Stroke): SteerStep {
  if (key.name === "escape" || (key.ctrl && key.name === "c"))
    return { kind: "close" };
  if (key.name === "return" || key.name === "enter") {
    const message = text.trim();
    return message ? { kind: "send", text: message } : { kind: "edit", text };
  }
  if (key.name === "backspace")
    return { kind: "edit", text: text.slice(0, -1) };
  if (key.ctrl || key.meta || !printable(key.sequence))
    return { kind: "edit", text };
  return { kind: "edit", text: text + key.sequence };
}

export function steerPaste(text: string, pasted: string): string {
  return text + pasted.replace(/\r?\n/g, " ");
}
