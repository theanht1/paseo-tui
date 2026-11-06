import type { TerminalStreamPort } from "../../connection/ports.js";
import { createEmitter } from "../../state/emitter.js";

interface TerminalScreen {
  write(data: string | Uint8Array): void;
  beginReplay(cols?: number, rows?: number): void;
  endReplay(): void;
}

/** `onExit` runs when the terminal's process exits, so its tab can close without waiting for the daemon's lists. */
export function createTerminalStore(
  id: string,
  port: TerminalStreamPort,
  onExit?: () => void,
) {
  const emitter = createEmitter();
  let closed = false;
  let subscription: ReturnType<TerminalStreamPort["observe"]> | undefined;
  let snapshot: { error: string | null } = { error: null };
  function report(error: unknown) {
    if (closed) return;
    snapshot = { error: String(error) };
    emitter.notify();
  }
  function perform(action: () => void) {
    if (closed) return;
    try {
      action();
    } catch (error) {
      report(error);
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    start(screen: TerminalScreen) {
      perform(() => {
        subscription = port.observe(
          id,
          (event) => {
            if (closed) return;
            const type: string = event.type;
            if (event.type === "output") screen.write(event.data);
            else if (event.type === "replay") {
              if (event.replay.type === "begin")
                screen.beginReplay(event.replay.cols, event.replay.rows);
              else if (event.replay.type === "data")
                screen.write(event.replay.data);
              else if (event.replay.type === "end") screen.endReplay();
            } else screen.write(`\r\n\x1b[2m[${type}]\x1b[0m\r\n`);
          },
          report,
          () => {
            if (!closed) onExit?.();
          },
        );
        void subscription.ready.catch(report);
      });
    },
    write(data: string) {
      perform(() => port.write(id, data));
    },
    resize(cols: number, rows: number) {
      perform(() => port.resize(id, cols, rows));
    },
    close() {
      closed = true;
      void subscription?.close().catch(() => {});
      emitter.clear();
    },
  };
}
