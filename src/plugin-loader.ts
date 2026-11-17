import { registerHooks } from "node:module";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TuiPlugin } from "./ui/plugins/api.js";
import { parsePluginModule } from "./ui/plugins/plugin-module.js";

/** Packages a plugin must share with paseo-tui: a second copy has its own renderer state. */
const SHARED = ["react", "@opentui/react", "@opentui/core"];
/** Marks a config `plugins` package name, resolved from the config file's directory. */
const CONFIGURED = "paseo-tui-plugin:";
const API = new URL(
  `./plugin${import.meta.url.endsWith(".ts") ? ".ts" : ".js"}`,
  import.meta.url,
).href;
/** paseo-tui's own files (`src/` or `dist/`), whose imports resolve as usual. */
const OWN = new URL(".", import.meta.url).href;

let configUrl: string | null = null;
/**
 * Makes plugin modules import paseo-tui's own `react`, `@opentui/*` and
 * `paseo-tui/plugin` wherever they are installed, and finds configured package
 * names beside the config file before paseo-tui's own dependencies.
 */
function registerResolution(configDir: string) {
  if (configUrl === null)
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith(CONFIGURED)) {
          const name = specifier.slice(CONFIGURED.length);
          try {
            return nextResolve(name, {
              ...context,
              parentURL: configUrl ?? API,
            });
          } catch {
            return nextResolve(name, { ...context, parentURL: API });
          }
        }
        if (context.parentURL?.startsWith(OWN))
          return nextResolve(specifier, context);
        if (specifier === "paseo-tui/plugin") return nextResolve(API, context);
        if (
          SHARED.some(
            (name) => specifier === name || specifier.startsWith(`${name}/`),
          )
        )
          return nextResolve(specifier, { ...context, parentURL: API });
        return nextResolve(specifier, context);
      },
    });
  configUrl = pathToFileURL(join(configDir, "config.json")).href;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export interface LoadedPlugins {
  plugins: TuiPlugin[];
  /** Why each skipped module was skipped. */
  errors: string[];
}
/**
 * Imports the configured plugin modules (absolute paths or package names) in
 * this process. A module that fails is reported and skipped.
 */
export async function loadPlugins(
  specifiers: readonly string[],
  configDir: string,
): Promise<LoadedPlugins> {
  const plugins: TuiPlugin[] = [];
  const errors: string[] = [];
  const sources = new Map<string, string>();
  if (specifiers.length > 0) registerResolution(configDir);
  for (const specifier of specifiers) {
    let module: unknown;
    try {
      module = await import(
        isAbsolute(specifier)
          ? pathToFileURL(specifier).href
          : `${CONFIGURED}${specifier}`
      );
    } catch (error) {
      errors.push(`Plugin ${specifier} failed to load: ${message(error)}`);
      continue;
    }
    try {
      const plugin = parsePluginModule(module);
      const twin = sources.get(plugin.id);
      if (twin !== undefined)
        throw Error(`has the id "${plugin.id}" that ${twin} already uses`);
      sources.set(plugin.id, specifier);
      plugins.push(plugin);
    } catch (error) {
      errors.push(`Plugin ${specifier} ${message(error)}`);
    }
  }
  return { plugins, errors };
}
