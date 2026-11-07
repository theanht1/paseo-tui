import type { Connection } from "../connection/connect.js";
import type { HostConnectionState as ConnectionState } from "../connection/ports.js";
import { createEmitter } from "../state/emitter.js";
import type { ExternalStore } from "./use-store.js";
export function watchConnection(
  connection: Pick<Connection, "onConnectionState">,
  onReconnect: () => void,
): ExternalStore<ConnectionState> & { close(): void } {
  const emitter = createEmitter();
  let state: ConnectionState = { status: "connected" };
  const stop = connection.onConnectionState((next) => {
    const wasDown = state.status !== "connected";
    state = next;
    emitter.notify();
    if (wasDown && next.status === "connected") onReconnect();
  });
  return {
    getSnapshot: () => state,
    subscribe: emitter.subscribe,
    close() {
      stop();
      emitter.clear();
    },
  };
}
