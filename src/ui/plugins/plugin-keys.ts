import {
  actionId,
  applyKeyOverrides,
  type KeyOverrideResult,
} from "../input/key-overrides.js";
import type { Action, Binding } from "../input/keymap.js";
import type { TuiPluginAction } from "./api.js";

export const PLUGIN_KEY_PREFIX = "plugin.";

interface KeyedAction {
  pluginId: string;
  action: Pick<TuiPluginAction, "id" | "title" | "defaultKeys">;
}

/**
 * The key table with the registered plugin actions bound: each action's
 * `plugin.<pluginId>.<actionId>` override from `keys`, else its default keys.
 * A key that cannot be bound is reported and left out; the action stays in the
 * Command Center. `active` plugins' unknown action names are reported too.
 */
export function pluginBindings(
  base: readonly Binding[],
  actions: readonly KeyedAction[],
  overrides: ReadonlyMap<string, readonly string[]>,
  active: ReadonlySet<string>,
): KeyOverrideResult {
  let bindings = base;
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const { pluginId, action } of actions) {
    const target: Action = {
      type: "plugin",
      plugin: pluginId,
      action: action.id,
    };
    const id = actionId(target);
    if (ids.has(id)) continue;
    ids.add(id);
    const unbound: Binding[] = [
      ...bindings,
      {
        keys: "",
        modes: ["normal"],
        action: target,
        description: action.title,
      },
    ];
    for (const keys of [overrides.get(id), action.defaultKeys]) {
      if (keys === undefined) continue;
      const result = applyKeyOverrides(unbound, new Map([[id, keys]]));
      errors.push(...result.errors);
      if (result.errors.length > 0) continue;
      bindings = result.bindings;
      break;
    }
  }
  for (const id of overrides.keys()) {
    const plugin = [...active].find((candidate) =>
      id.startsWith(`${PLUGIN_KEY_PREFIX}${candidate}.`),
    );
    if (plugin === undefined || ids.has(id)) continue;
    const valid = [...ids].filter((candidate) =>
      candidate.startsWith(`${PLUGIN_KEY_PREFIX}${plugin}.`),
    );
    errors.push(
      `keys.${JSON.stringify(id)}: unknown action; valid: ${valid.join(", ")}`,
    );
  }
  return { bindings, errors: [...new Set(errors)] };
}
/**
 * Problems with the `keys` entries that name a plugin, once every configured
 * plugin is loaded; their action names are checked when the plugin registers them.
 */
export function unloadedPluginKeys(
  keys: ReadonlyMap<string, readonly string[]>,
  pluginIds: readonly string[],
): string[] {
  return [...keys.keys()].flatMap((id) => {
    const where = `keys.${JSON.stringify(id)}`;
    const name = id.slice(PLUGIN_KEY_PREFIX.length);
    if (pluginIds.some((plugin) => name.startsWith(`${plugin}.`))) return [];
    return [
      name.includes(".")
        ? `${where}: no loaded plugin has this id; loaded: ${pluginIds.join(", ")}`
        : `${where}: expected plugin.<pluginId>.<actionId>`,
    ];
  });
}
