import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLocalCredentialForTarget } from "./local-credential.js";

const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("readLocalCredentialForTarget", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "paseo-tui-credential-"));
    await writeFile(join(home, "local-credential"), `${token}\n`);
    await writeFile(
      join(home, "paseo.pid"),
      JSON.stringify({ listen: "127.0.0.1:6767", pid: 42 }),
    );
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns the local token only for the listening endpoint", () => {
    expect(readLocalCredentialForTarget(home, "127.0.0.1:6767")).toBe(token);
    expect(readLocalCredentialForTarget(home, "127.0.0.1:7777")).toBeNull();
    expect(
      readLocalCredentialForTarget(home, "remote.example:6767"),
    ).toBeNull();
  });

  it.each([
    "localhost:6767",
    "tcp://localhost:6767",
    "6767",
    " localhost:6767 ",
  ])("normalizes loopback endpoints: %s", (target) => {
    expect(readLocalCredentialForTarget(home, target)).toBe(token);
  });

  it.each(["short", "!".repeat(43), "a".repeat(44)])(
    "rejects a malformed token: %s",
    async (credential) => {
      await writeFile(join(home, "local-credential"), credential);
      expect(readLocalCredentialForTarget(home, "localhost:6767")).toBeNull();
    },
  );

  it("returns null when the credential is missing", async () => {
    await rm(join(home, "local-credential"));
    expect(readLocalCredentialForTarget(home, "localhost:6767")).toBeNull();
  });

  it.each(["invalid json", "null", "{}", '{"listen":42}'])(
    "returns null for a malformed pid file: %s",
    async (content) => {
      await writeFile(join(home, "paseo.pid"), content);
      expect(readLocalCredentialForTarget(home, "localhost:6767")).toBeNull();
    },
  );

  it("returns null when the pid file is missing", async () => {
    await rm(join(home, "paseo.pid"));
    expect(readLocalCredentialForTarget(home, "localhost:6767")).toBeNull();
  });

  it.each([
    { listen: "unix:///tmp/paseo.sock", target: "/tmp/paseo.sock" },
    { listen: "tcp://127.0.0.1:6767", target: "localhost:6767" },
    { listen: "tcp://[::1]:6767", target: "[::1]:6767" },
    {
      listen: "pipe://\\\\.\\pipe\\paseo",
      target: "\\\\.\\pipe\\paseo",
    },
  ])("normalizes transport addresses: $listen", async ({ listen, target }) => {
    await writeFile(join(home, "paseo.pid"), JSON.stringify({ listen }));
    expect(readLocalCredentialForTarget(home, target)).toBe(token);
  });
});
