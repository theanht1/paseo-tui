import { expect, test } from "vitest";
import { BINDINGS } from "../input/bindings.js";
import { helpRows } from "../input/keymap.js";
import { createTheme } from "../render/theme.js";
import {
  loadUserConfig,
  parseUserConfig,
  userConfigPath,
} from "./user-config.js";

test("the config lives under XDG_CONFIG_HOME, else ~/.config", () => {
  expect(userConfigPath({ XDG_CONFIG_HOME: "/xdg" }, "/home/me")).toBe(
    "/xdg/paseo-tui/config.json",
  );
  expect(userConfigPath({}, "/home/me")).toBe(
    "/home/me/.config/paseo-tui/config.json",
  );
});

test("an empty config keeps the defaults", () => {
  const config = parseUserConfig("{}", "config.json");
  expect(config.bindings).toBe(BINDINGS);
  expect(config.theme).toEqual({});
  expect(config.prefix).toBeUndefined();
  expect(config.notify).toBeUndefined();
});

test("parses keys, theme, prefix and notify", () => {
  const config = parseUserConfig(
    JSON.stringify({
      keys: { "sidebar.toggle": "|", "pane.zoom": ["Z", "m"] },
      theme: {
        accent: "#ff8800",
        status: { running: "#0f0" },
        syntax: { keyword: "#12345678" },
        heading: ["#abcdef", "#000000"],
      },
      prefix: "C-a",
      notify: "bell",
    }),
    "config.json",
  );
  expect(
    helpRows("Ctrl-A", config.bindings)
      .filter((row) => row.description === "Toggle sidebar")
      .map((row) => row.keys),
  ).toEqual(["|"]);
  expect(createTheme({}, config.theme).status.running).toBe("#0f0");
  expect(config.theme.heading).toEqual(["#abcdef", "#000000"]);
  expect(config.prefix).toBe("C-a");
  expect(config.notify).toBe("bell");
});

test("lists every problem in one startup error", () => {
  expect(() =>
    parseUserConfig(
      JSON.stringify({
        keys: { "tab.explode": "x", "pane.zoom": 3 },
        theme: {
          accent: "orange",
          sparkle: "#fff",
          status: { busy: "#fff" },
          syntax: "nope",
          heading: ["#fff", "#fff", "#fff", "#fff"],
        },
        prefix: "Ctrl-a",
        notify: "loud",
        colour: true,
      }),
      "/home/me/.config/paseo-tui/config.json",
    ),
  ).toThrow(
    new RegExp(
      [
        "^Invalid config /home/me/\\.config/paseo-tui/config\\.json:",
        '  - unknown setting "colour" \\(expected keys, theme, prefix, notify, usage, editor\\)',
        '  - keys\\."pane\\.zoom": expected a key string or an array of key strings',
        '  - keys\\."tab\\.explode": unknown action; valid: .*',
        '  - theme\\.accent: "orange" is not a hex color \\(#rgb, #rrggbb or #rrggbbaa\\)',
        "  - theme\\.sparkle: unknown color \\(valid: fg, .*\\)",
        "  - theme\\.status\\.busy: unknown status \\(valid: running, idle, error, attention, question\\)",
        "  - theme\\.syntax: expected an object of colors",
        "  - theme\\.heading: expected up to 3 colors",
        "  - prefix: must be C-<letter> \\(for example C-a\\)",
        "  - notify: must be one of osc9, osc777, bell, off$",
      ].join("\n"),
    ),
  );
});

test("rejects JSON that is not an object", () => {
  expect(() => parseUserConfig("[]", "c.json")).toThrow(
    "Invalid config c.json:\n  - expected a JSON object",
  );
  expect(() => parseUserConfig("{", "c.json")).toThrow(
    /^Invalid config c\.json: /,
  );
});

test("a missing default config is empty, a missing --config path is an error", async () => {
  const missing = { read: async () => null };
  expect((await loadUserConfig(missing, "a.json", false)).bindings).toBe(
    BINDINGS,
  );
  await expect(loadUserConfig(missing, "a.json", true)).rejects.toThrow(
    "Config file a.json not found",
  );
  const present = { read: async () => '{"notify":"off"}' };
  expect((await loadUserConfig(present, "a.json", true)).notify).toBe("off");
});

test("parses usage selections", () => {
  const config = parseUserConfig(
    JSON.stringify({
      usage: {
        claude: ["five_hour", "seven_day"],
        codex: true,
        openrouter: false,
      },
    }),
    "c.json",
  );
  expect([...(config.usage ?? [])]).toEqual([
    ["claude", ["five_hour", "seven_day"]],
    ["codex", "default"],
    ["openrouter", "hidden"],
  ]);
});

test("rejects bad usage values", () => {
  expect(() => parseUserConfig('{"usage": []}', "c.json")).toThrow(
    "  - usage: expected an object of provider ids",
  );
  expect(() =>
    parseUserConfig('{"usage": {"claude": "5h"}}', "c.json"),
  ).toThrow(
    '  - usage."claude": expected true, false or an array of usage ids',
  );
  expect(() => parseUserConfig('{"usage": {"claude": [1]}}', "c.json")).toThrow(
    '  - usage."claude": expected true, false or an array of usage ids',
  );
});

test("usage is undefined when not configured", () => {
  expect(parseUserConfig("{}", "c.json").usage).toBeUndefined();
});

test("parses and validates the editor command", () => {
  expect(parseUserConfig('{"editor": "hx"}', "c.json").editor).toBe("hx");
  expect(parseUserConfig("{}", "c.json").editor).toBeUndefined();
  expect(() => parseUserConfig('{"editor": "  "}', "c.json")).toThrow(
    "  - editor: needs a command",
  );
  expect(() => parseUserConfig('{"editor": 3}', "c.json")).toThrow(
    "  - editor: expected a string",
  );
});
