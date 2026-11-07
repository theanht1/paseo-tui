import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isEntryPoint } from "./entry-point.js";

let dir: string;
let script: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paseo-tui-entry-"));
  script = join(dir, "cli.js");
  writeFileSync(script, "");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("is the entry point when run by its own path", () => {
  expect(isEntryPoint(script, pathToFileURL(script).href)).toBe(true);
});

it("is the entry point when run through a bin symlink, as npm installs it", () => {
  const bin = join(dir, "paseo-tui");
  symlinkSync(script, bin);
  expect(isEntryPoint(bin, pathToFileURL(script).href)).toBe(true);
});

it("is not the entry point when another script imports it", () => {
  const other = join(dir, "vitest.js");
  writeFileSync(other, "");
  expect(isEntryPoint(other, pathToFileURL(script).href)).toBe(false);
  expect(isEntryPoint(undefined, pathToFileURL(script).href)).toBe(false);
});

function versionIn(path: string): string {
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof json !== "object" ||
    json === null ||
    !("version" in json) ||
    typeof json.version !== "string"
  )
    throw Error(`No version in ${path}`);
  return json.version;
}

it("prints both package versions and exits for --version", async () => {
  const { execFileSync } = await import("node:child_process");
  const output = execFileSync(
    process.execPath,
    ["--experimental-ffi", "--import", "tsx", "src/cli.tsx", "--version"],
    { encoding: "utf8" },
  );
  expect(output).toContain(`paseo-tui        ${versionIn("package.json")}`);
  expect(output).toContain(
    `@getpaseo/client ${versionIn("node_modules/@getpaseo/client/package.json")}`,
  );
});
