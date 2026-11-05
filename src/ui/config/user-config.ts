import { join } from "node:path";
import type { PreferenceStorage } from "../agent/thinking-preference.js";
import { BINDINGS } from "../input/bindings.js";
import { applyKeyOverrides } from "../input/key-overrides.js";
import { type Binding, parsePrefix } from "../input/keymap.js";
import {
  type NotifyStyle,
  parseNotifyStyle,
} from "../notify/terminal-notification.js";
import {
  isHighlightStyle,
  THEME_COLOR_FIELDS,
  THEME_STATUS_FIELDS,
  type ThemeOverrides,
} from "../render/theme.js";

/** The validated user config; absent settings fall back to CLI flags and defaults. */
export interface UserConfig {
  /** The effective key table: defaults with the configured `keys` applied. */
  bindings: readonly Binding[];
  theme: ThemeOverrides;
  prefix?: string;
  notify?: NotifyStyle;
}

export function userConfigPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(
    env.XDG_CONFIG_HOME || join(home, ".config"),
    "paseo-tui",
    "config.json",
  );
}

const SETTINGS = ["keys", "theme", "prefix", "notify"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function color(value: unknown, where: string, errors: string[]): string | null {
  if (
    typeof value === "string" &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
  )
    return value;
  errors.push(
    `${where}: ${JSON.stringify(value)} is not a hex color (#rgb, #rrggbb or #rrggbbaa)`,
  );
  return null;
}

function parseKeys(
  value: unknown,
  errors: string[],
): ReadonlyMap<string, readonly string[]> {
  const overrides = new Map<string, readonly string[]>();
  if (value === undefined) return overrides;
  if (!isRecord(value)) {
    errors.push("keys: expected an object of action names to keys");
    return overrides;
  }
  for (const [id, keys] of Object.entries(value)) {
    if (typeof keys === "string") overrides.set(id, [keys]);
    else if (
      Array.isArray(keys) &&
      keys.every((key): key is string => typeof key === "string")
    )
      overrides.set(id, keys);
    else
      errors.push(
        `keys.${JSON.stringify(id)}: expected a key string or an array of key strings`,
      );
  }
  return overrides;
}

function parseTheme(value: unknown, errors: string[]): ThemeOverrides {
  const theme: ThemeOverrides = {};
  if (value === undefined) return theme;
  if (!isRecord(value)) {
    errors.push("theme: expected an object of colors");
    return theme;
  }
  for (const [key, raw] of Object.entries(value)) {
    const where = `theme.${key}`;
    if (key === "status") {
      if (!isRecord(raw)) {
        errors.push(`${where}: expected an object of colors`);
        continue;
      }
      const status: ThemeOverrides["status"] = {};
      for (const [name, entry] of Object.entries(raw)) {
        const field = THEME_STATUS_FIELDS.find((f) => f === name);
        const parsed = field ? color(entry, `${where}.${name}`, errors) : null;
        if (!field)
          errors.push(
            `${where}.${name}: unknown status (valid: ${THEME_STATUS_FIELDS.join(", ")})`,
          );
        else if (parsed !== null) status[field] = parsed;
      }
      theme.status = status;
    } else if (key === "syntax") {
      if (!isRecord(raw)) {
        errors.push(`${where}: expected an object of colors`);
        continue;
      }
      const syntax: ThemeOverrides["syntax"] = {};
      for (const [name, entry] of Object.entries(raw)) {
        if (!isHighlightStyle(name)) {
          errors.push(`${where}.${name}: unknown syntax style`);
          continue;
        }
        const parsed = color(entry, `${where}.${name}`, errors);
        if (parsed !== null) syntax[name] = parsed;
      }
      theme.syntax = syntax;
    } else if (key === "heading") {
      if (!Array.isArray(raw) || raw.length > 3) {
        errors.push(`${where}: expected up to 3 colors`);
        continue;
      }
      const heading = raw.map((entry, index) =>
        color(entry, `${where}[${index}]`, errors),
      );
      if (heading.every((entry) => entry !== null)) theme.heading = heading;
    } else {
      const field = THEME_COLOR_FIELDS.find((f) => f === key);
      if (!field) {
        errors.push(
          `${where}: unknown color (valid: ${[...THEME_COLOR_FIELDS, "status", "syntax", "heading"].join(", ")})`,
        );
        continue;
      }
      const parsed = color(raw, where, errors);
      if (parsed !== null) theme[field] = parsed;
    }
  }
  return theme;
}

function parseFlag<T>(
  name: string,
  value: unknown,
  parse: (value: string) => T,
  errors: string[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors.push(`${name}: expected a string`);
    return undefined;
  }
  try {
    return parse(value);
  } catch (error) {
    errors.push(
      `${name}: ${error instanceof Error ? error.message.replace(`--${name} `, "") : String(error)}`,
    );
    return undefined;
  }
}

/** Validates config JSON; throws one error listing every problem. */
export function parseUserConfig(text: string, source: string): UserConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid config ${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const errors: string[] = [];
  if (!isRecord(parsed)) errors.push("expected a JSON object");
  const value = isRecord(parsed) ? parsed : {};
  for (const key of Object.keys(value))
    if (!SETTINGS.includes(key))
      errors.push(
        `unknown setting ${JSON.stringify(key)} (expected ${SETTINGS.join(", ")})`,
      );
  const overrides = parseKeys(value.keys, errors);
  const keys =
    overrides.size > 0 ? applyKeyOverrides(BINDINGS, overrides) : null;
  if (keys) errors.push(...keys.errors);
  const theme = parseTheme(value.theme, errors);
  const prefix = parseFlag(
    "prefix",
    value.prefix,
    (raw) => {
      parsePrefix(raw);
      return raw;
    },
    errors,
  );
  const notify = parseFlag("notify", value.notify, parseNotifyStyle, errors);
  if (errors.length > 0)
    throw new Error(
      `Invalid config ${source}:\n${errors.map((error) => `  - ${error}`).join("\n")}`,
    );
  return {
    bindings: keys?.bindings ?? BINDINGS,
    theme,
    ...(prefix === undefined ? {} : { prefix }),
    ...(notify === undefined ? {} : { notify }),
  };
}

/**
 * Reads the config at `source`. A missing file is an empty config unless the
 * path was given explicitly (`--config`).
 */
export async function loadUserConfig(
  storage: Pick<PreferenceStorage, "read">,
  source: string,
  required: boolean,
): Promise<UserConfig> {
  const text = await storage.read();
  if (text === null) {
    if (required) throw new Error(`Config file ${source} not found`);
    return { bindings: BINDINGS, theme: {} };
  }
  return parseUserConfig(text, source);
}
