import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const run = promisify(execFile);
const driver = fileURLToPath(
  new URL("./test/plugin-loader-driver.ts", import.meta.url),
);
let root = "";
async function write(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
function pluginSource(id: string, version = 1) {
  return `import { createElement } from "react";
import { useKeyboard } from "@opentui/react";
import { defineTuiPlugin, useViewKeyboard } from "paseo-tui/plugin";
export default defineTuiPlugin({
  id: ${JSON.stringify(id)},
  apiVersion: ${version},
  activate() {
    (globalThis.__pluginProbe ??= {})[${JSON.stringify(id)}] = { createElement, useKeyboard, useViewKeyboard };
  },
});
`;
}
async function load(...specifiers: string[]) {
  const { stdout } = await run(
    process.execPath,
    [
      "--experimental-ffi",
      "--no-warnings=ExperimentalWarning",
      "--import",
      "tsx",
      driver,
      join(root, "config"),
      ...specifiers,
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );
  const result: unknown = JSON.parse(stdout);
  return result;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "paseo-tui-plugins-"));
  // A plugin next to its own copies of the shared packages.
  await write(join(root, "by-path", "index.js"), pluginSource("by-path"));
  await write(join(root, "by-path", "package.json"), '{"type":"module"}');
  for (const name of ["react", "@opentui/react"]) {
    const decoy = join(root, "by-path", "node_modules", name);
    await write(
      join(decoy, "package.json"),
      '{"type":"module","main":"index.js"}',
    );
    await write(
      join(decoy, "index.js"),
      'export const createElement = "decoy"; export const useKeyboard = "decoy";',
    );
  }
  // A package installed beside the config file.
  const installed = join(root, "config", "node_modules", "@acme", "board-tui");
  await write(
    join(installed, "package.json"),
    '{"name":"@acme/board-tui","type":"module","exports":{"./tui":"./tui.js"}}',
  );
  await write(join(installed, "tui.js"), pluginSource("by-name"));
  await write(join(root, "old.mjs"), pluginSource("old", 2));
  await write(join(root, "empty.mjs"), "export const nothing = 1;");
  await write(join(root, "throws.mjs"), 'throw new Error("top-level boom");');
  await write(join(root, "twin.mjs"), pluginSource("by-path"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

test("loads plugins by path and by package name, sharing paseo-tui's React and OpenTUI", async () => {
  expect(
    await load(join(root, "by-path", "index.js"), "@acme/board-tui/tui"),
  ).toEqual({
    ids: ["by-path", "by-name"],
    errors: [],
    probes: {
      "by-path": { react: true, opentui: true, api: true },
      "by-name": { react: true, opentui: true, api: true },
    },
  });
}, 30_000);

test("a plugin that cannot load is reported and skipped", async () => {
  const old = join(root, "old.mjs");
  const empty = join(root, "empty.mjs");
  const throws = join(root, "throws.mjs");
  const twin = join(root, "twin.mjs");
  const good = join(root, "by-path", "index.js");
  const missing = join(root, "missing.mjs");
  expect(
    await load(old, empty, throws, good, twin, missing, "not-installed"),
  ).toEqual({
    ids: ["by-path"],
    errors: [
      `Plugin ${old} uses plugin API version 2; this paseo-tui supports version 1. Update the plugin or paseo-tui`,
      `Plugin ${empty} has no default export; export default defineTuiPlugin({ … })`,
      `Plugin ${throws} failed to load: top-level boom`,
      `Plugin ${twin} has the id "by-path" that ${good} already uses`,
      expect.stringMatching(
        /^Plugin .+missing\.mjs failed to load: Cannot find module/,
      ),
      expect.stringMatching(
        /^Plugin not-installed failed to load: Cannot find package 'not-installed'/,
      ),
    ],
    probes: { "by-path": { react: true, opentui: true, api: true } },
  });
}, 30_000);
