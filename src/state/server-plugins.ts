import type { PluginPort } from "../connection/ports.js";
import { createEmitter } from "./emitter.js";

export type ServerPluginsSnapshot =
  | { kind: "offline" }
  | { kind: "loading" }
  | { kind: "ready"; running: ReadonlySet<string> };

function same(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Which server plugins run on a host, kept live from `plugin_catalog_changed`. */
export function createServerPluginStore(port: PluginPort) {
  const emitter = createEmitter();
  let snapshot: ServerPluginsSnapshot = { kind: "loading" };
  let request = 0;
  function publish(next: ServerPluginsSnapshot) {
    snapshot = next;
    emitter.notify();
  }
  async function load() {
    const id = ++request;
    if (snapshot.kind === "offline") publish({ kind: "loading" });
    let running: ReadonlySet<string>;
    try {
      running = new Set(
        (await port.list())
          .filter((plugin) => plugin.running)
          .map((plugin) => plugin.id),
      );
    } catch {
      return;
    }
    if (id !== request) return;
    if (snapshot.kind === "ready" && same(snapshot.running, running)) return;
    publish({ kind: "ready", running });
  }
  const release = port.observe(() => void load());
  void load();
  return {
    serverId: port.serverId,
    getSnapshot: () => snapshot,
    subscribe: emitter.subscribe,
    rpc: port.rpc,
    load,
    /** The connection dropped: nothing runs until the next `load`. */
    offline() {
      request++;
      if (snapshot.kind !== "offline") publish({ kind: "offline" });
    },
    async close() {
      request++;
      emitter.clear();
      await release();
    },
  };
}
export type ServerPluginStore = ReturnType<typeof createServerPluginStore>;
