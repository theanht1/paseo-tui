import { createEmitter } from "../../state/emitter.js";
import type { ServerPluginsSnapshot } from "../../state/server-plugins.js";
import type { Theme } from "../render/theme.js";
import type { ExternalStore } from "../use-store.js";
import type {
  TuiPlugin,
  TuiPluginAction,
  TuiPluginContext,
  TuiPluginNoticeLevel,
  TuiPluginView,
} from "./api.js";

/** A connected host, as plugins see it. */
export interface PluginHostEntry {
  id: string;
  label: string;
  /** One object per connection; null when the daemon lacks plugin support. */
  server: {
    serverId: string;
    rpc(pluginId: string, method: string, input: unknown): Promise<unknown>;
  } | null;
  state: ServerPluginsSnapshot;
}
export interface PluginViewTarget {
  hostId: string;
  pluginId: string;
  viewId: string;
}
/** What the window does for plugins. */
export interface PluginHostUi {
  openView(target: PluginViewTarget): void;
  focusWorkspace(workspaceId: string): void;
  notify(text: string, level: TuiPluginNoticeLevel): void;
}
export interface PluginViewEntry {
  hostId: string;
  pluginId: string;
  view: TuiPluginView;
}
export interface PluginActionEntry {
  hostId: string;
  hostLabel: string;
  pluginId: string;
  action: TuiPluginAction;
}
export interface PluginHostSnapshot {
  views: readonly PluginViewEntry[];
  actions: readonly PluginActionEntry[];
  /** Hosts whose plugins all finished starting: what they lack now is not coming. */
  settled: ReadonlySet<string>;
}
type PluginServer = NonNullable<PluginHostEntry["server"]>;
interface Activation {
  entry: PluginHostEntry;
  server: PluginServer;
  plugin: TuiPlugin;
  state: "pending" | "active" | "failed" | "disposed";
  views: Map<string, TuiPluginView>;
  actions: Map<string, TuiPluginAction>;
  disposers: (() => void)[];
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
function checkId(kind: string, id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[\w-]+$/.test(id))
    throw Error(
      `${kind} id ${JSON.stringify(id)} must use letters, digits, - and _`,
    );
}

/**
 * Runs the loaded TUI plugins: each is activated once per connected host whose
 * daemon runs the server plugin of the same id, and loses its views and actions
 * when that stops being true. A plugin's failures become status messages.
 */
export function createPluginHost(options: {
  plugins: readonly TuiPlugin[];
  theme: Theme;
  hosts: ExternalStore<readonly PluginHostEntry[]>;
  /** Problems from loading the plugin modules, shown once the window attaches. */
  notices?: readonly string[];
}) {
  const emitter = createEmitter();
  const theme = deepFreeze(structuredClone(options.theme));
  const activations = new Map<string, Activation>();
  const unsupported = new Set<string>();
  let ui: PluginHostUi | null = null;
  let queued: ((ui: PluginHostUi) => void)[] = [];
  let snapshot: PluginHostSnapshot = {
    views: [],
    actions: [],
    settled: new Set(),
  };
  let dirty = false;

  function send(call: (ui: PluginHostUi) => void) {
    if (ui) call(ui);
    else queued.push(call);
  }
  function notify(text: string, level: TuiPluginNoticeLevel) {
    send((target) => target.notify(text, level));
  }
  function failed(activation: Activation, error: unknown) {
    notify(
      `Plugin ${activation.plugin.id} failed on ${activation.entry.label}: ${message(error)}`,
      "error",
    );
  }
  function publish() {
    dirty = false;
    const live = [...activations.values()];
    snapshot = {
      views: live.flatMap(({ entry, plugin, views }) =>
        [...views.values()].map((view) => ({
          hostId: entry.id,
          pluginId: plugin.id,
          view,
        })),
      ),
      actions: live.flatMap(({ entry, plugin, actions }) =>
        [...actions.values()].map((action) => ({
          hostId: entry.id,
          hostLabel: entry.label,
          pluginId: plugin.id,
          action,
        })),
      ),
      settled: new Set(
        options.hosts
          .getSnapshot()
          .filter(
            (entry) =>
              (entry.server === null || entry.state.kind === "ready") &&
              !live.some(
                (activation) =>
                  activation.entry.id === entry.id &&
                  activation.state === "pending",
              ),
          )
          .map((entry) => entry.id),
      ),
    };
    emitter.notify();
  }
  /** Drops the activation's registrations and runs its disposers, newest first. */
  function teardown(activation: Activation, state: "failed" | "disposed") {
    activation.state = state;
    activation.views.clear();
    activation.actions.clear();
    for (const dispose of activation.disposers.splice(0).reverse())
      try {
        dispose();
      } catch (error) {
        failed(activation, error);
      }
    dirty = true;
  }
  function registered(activation: Activation) {
    return activation.state === "pending" || activation.state === "active";
  }
  function context(activation: Activation): TuiPluginContext {
    const { entry, server, plugin } = activation;
    function register<T extends { id: string }>(
      kind: string,
      items: Map<string, T>,
      item: T,
    ) {
      if (!registered(activation)) return () => {};
      checkId(kind, item.id);
      if (items.has(item.id))
        throw Error(`${kind} "${item.id}" is already registered`);
      items.set(item.id, item);
      publish();
      return () => {
        if (items.get(item.id) !== item) return;
        items.delete(item.id);
        publish();
      };
    }
    return {
      host: { serverId: server.serverId, label: entry.label },
      async rpc(method, input) {
        if (!registered(activation))
          throw Error(
            `Plugin ${plugin.id} is no longer active on ${entry.label}`,
          );
        return server.rpc(plugin.id, method, input);
      },
      registerView: (view) => register("View", activation.views, view),
      registerAction: (action) =>
        register("Action", activation.actions, action),
      openView(viewId) {
        if (!activation.views.has(viewId))
          throw Error(`Plugin ${plugin.id} has no view "${viewId}"`);
        send((target) =>
          target.openView({ hostId: entry.id, pluginId: plugin.id, viewId }),
        );
      },
      focusWorkspace(workspaceId) {
        send((target) => target.focusWorkspace(workspaceId));
      },
      notify(text, level = "info") {
        notify(text, level);
      },
      theme,
      onDispose(dispose) {
        if (registered(activation)) activation.disposers.push(dispose);
      },
    };
  }
  async function activate(
    key: string,
    entry: PluginHostEntry,
    server: PluginServer,
    plugin: TuiPlugin,
  ) {
    const activation: Activation = {
      entry,
      server,
      plugin,
      state: "pending",
      views: new Map(),
      actions: new Map(),
      disposers: [],
    };
    activations.set(key, activation);
    try {
      await plugin.activate(context(activation));
      if (activation.state !== "pending") return;
      activation.state = "active";
    } catch (error) {
      if (activation.state !== "pending") return;
      failed(activation, error);
      teardown(activation, "failed");
    }
    publish();
  }
  function runs(entry: PluginHostEntry, plugin: TuiPlugin) {
    return entry.state.kind === "ready" && entry.state.running.has(plugin.id);
  }
  let settledKey = "";
  function sync() {
    const entries = options.hosts.getSnapshot();
    for (const [key, activation] of activations) {
      const entry = entries.find(
        (candidate) => candidate.id === activation.entry.id,
      );
      if (entry?.server === activation.server && runs(entry, activation.plugin))
        continue;
      activations.delete(key);
      teardown(activation, "disposed");
    }
    for (const entry of entries) {
      const { server } = entry;
      if (server === null) {
        if (options.plugins.length === 0 || unsupported.has(entry.id)) continue;
        unsupported.add(entry.id);
        notify(
          `Update the Paseo daemon on ${entry.label} to use plugins (plugins and pluginManagement required).`,
          "error",
        );
        continue;
      }
      for (const plugin of options.plugins) {
        const key = `${entry.id}\0${plugin.id}`;
        if (activations.has(key) || !runs(entry, plugin)) continue;
        dirty = true;
        void activate(key, entry, server, plugin);
      }
    }
    const nextSettled = entries
      .map(
        (entry) => `${entry.id}:${entry.server === null || entry.state.kind}`,
      )
      .join("\n");
    if (dirty || nextSettled !== settledKey) publish();
    settledKey = nextSettled;
  }
  for (const text of options.notices ?? []) notify(text, "error");
  const stop = options.hosts.subscribe(sync);
  sync();
  return {
    subscribe: emitter.subscribe,
    getSnapshot: () => snapshot,
    /** Attaches the window; messages from before it existed are delivered now. */
    connect(target: PluginHostUi) {
      ui = target;
      for (const call of queued.splice(0)) call(target);
      return () => {
        if (ui === target) ui = null;
        queued = [];
      };
    },
    /** Runs an action; a failure becomes a status message. */
    async run(entry: PluginActionEntry) {
      try {
        await entry.action.run();
      } catch (error) {
        notify(`${entry.action.title} failed: ${message(error)}`, "error");
      }
    },
    close() {
      stop();
      for (const activation of activations.values())
        teardown(activation, "disposed");
      activations.clear();
      emitter.clear();
    },
  };
}
export type PluginHost = ReturnType<typeof createPluginHost>;
