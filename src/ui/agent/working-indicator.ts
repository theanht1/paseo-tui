import { createEmitter } from "../../state/emitter.js";
export function createWorkingIndicator(startedAt = Date.now()) {
  const emitter = createEmitter();
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let frame = 0;
  return {
    getSnapshot: () => frames[frame],
    elapsed() {
      const seconds = Math.floor(Math.max(0, Date.now() - startedAt) / 1000);
      return seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    },
    subscribe: emitter.subscribe,
    start() {
      const timer = setInterval(() => {
        frame = (frame + 1) % frames.length;
        emitter.notify();
      }, 100);
      return () => {
        clearInterval(timer);
        emitter.clear();
      };
    },
  };
}
/** The pane's line while a stop is under way; `key` is the stop key's label. */
export function stopText(
  phase: "requested" | "acknowledged" | "stalled",
  key: string,
): string {
  switch (phase) {
    case "requested":
      return "Stopping…";
    case "acknowledged":
      return "Stop requested.";
    case "stalled":
      return `Agent still stopping; press ${key} again to retry`;
  }
}
