import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveListen, resolveTarget } from "./target.js";

describe("resolveTarget", () => {
  it("defaults to the local Paseo home", () => {
    expect(resolveTarget({}, {})).toEqual({
      kind: "home",
      home: join(homedir(), ".paseo"),
    });
  });

  it("uses PASEO_HOME and resolves relative paths", () => {
    expect(resolveTarget({}, { PASEO_HOME: "custom-paseo" })).toEqual({
      kind: "home",
      home: resolve("custom-paseo"),
    });
  });

  it("uses PASEO_HOST", () => {
    expect(resolveTarget({}, { PASEO_HOST: "ssh://dev" })).toEqual({
      kind: "host",
      connection: "ssh://dev",
    });
  });

  it.each([
    {
      argv: { host: "localhost:7777" },
      expected: { kind: "host", connection: "localhost:7777" },
    },
    {
      argv: { home: "~/other-paseo" },
      expected: { kind: "home", home: join(homedir(), "other-paseo") },
    },
  ])(
    "lets an explicit flag override both environment variables: $argv",
    ({ argv, expected }) => {
      expect(
        resolveTarget(argv, {
          PASEO_HOST: "env:6767",
          PASEO_HOME: "/env-home",
        }),
      ).toEqual(expected);
    },
  );

  it("rejects conflicting environment variables without a flag", () => {
    expect(() =>
      resolveTarget({}, { PASEO_HOST: "localhost:6767", PASEO_HOME: "/home" }),
    ).toThrow(
      "PASEO_HOME and PASEO_HOST are both set. Choose --home or --host explicitly.",
    );
  });

  it("rejects both flags like the CLI", () => {
    expect(() =>
      resolveTarget({ host: "localhost:6767", home: "/home" }, {}),
    ).toThrow("Choose either --home or --host, not both.");
  });

  it.each([{ host: " " }, { home: "" }])("rejects empty flags: $0", (argv) => {
    expect(() => resolveTarget(argv, {})).toThrow(/requires a non-empty value/);
  });
});

describe("resolveListen", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "paseo-tui-target-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reads the listen address and tolerates unknown fields", async () => {
    await writeFile(
      join(home, "paseo.pid"),
      JSON.stringify({
        listen: "unix:///tmp/paseo.sock",
        pid: 42,
        future: true,
      }),
    );
    expect(resolveListen(home)).toBe("unix:///tmp/paseo.sock");
  });

  it("explains how to recover when the pid file is missing", () => {
    expect(() => resolveListen(home)).toThrow(
      `Paseo daemon is not running for ${home} (no paseo.pid). Start Paseo, or pass --host.`,
    );
  });

  it.each([
    "invalid json",
    "null",
    "[]",
    "{}",
    '{"listen":42}',
    '{"listen":" "}',
  ])("rejects an unreadable listen address: %s", async (content) => {
    await writeFile(join(home, "paseo.pid"), content);
    expect(() => resolveListen(home)).toThrow(
      `Paseo daemon is not running for ${home} (no paseo.pid). Start Paseo, or pass --host.`,
    );
  });
});
