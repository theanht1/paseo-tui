import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connect } from "../connection/connect.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, fail) =>
    server.once("error", fail).listen(0, "127.0.0.1", ok),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP port assigned");
  await new Promise<void>((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
  if (address.port === 6767) return freePort();
  return address.port;
}

/** A server plugin answering `echo`, for plugin RPC tests. */
const FIXTURE_PLUGIN = `import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
const echo = defineRpc({
  name: "echo",
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string(), from: z.string() }),
});
export default function contribute(server) {
  server.handle(echo, ({ text }) => ({ text, from: "tui-fixture" }));
  return () => {};
}
`;
async function writeFixturePlugin(home: string): Promise<string> {
  const directory = join(home, "tui-fixture-plugin");
  await mkdir(directory);
  await writeFile(
    join(directory, "paseo-plugin.json"),
    JSON.stringify({ id: "tui-fixture", requirements: { paseo: ">=0.15.0" } }),
  );
  await writeFile(join(directory, "index.server.ts"), FIXTURE_PLUGIN);
  // The daemon bundles the plugin's imports from its own directory.
  await symlink(resolve("node_modules"), join(directory, "node_modules"));
  return directory;
}

export async function startTestDaemon() {
  const home = await mkdtemp(join(tmpdir(), "paseo-tui-test-"));
  if (resolve(home) === resolve(homedir(), ".paseo"))
    throw new Error("Unsafe daemon home");
  const port = await freePort();
  const host = `127.0.0.1:${port}`;
  const providers = Object.fromEntries(
    [
      "claude",
      "codex",
      "copilot",
      "opencode",
      "pi",
      "omp",
      "antigravity",
      "muse",
    ].map((id) => [id, { enabled: false }]),
  );
  const plugin = await writeFixturePlugin(home);
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      agents: { providers },
      pluginsEnabled: true,
      plugins: { "tui-fixture": { source: "directory", path: plugin } },
      features: {
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    }),
  );
  const child = spawn(
    process.execPath,
    [
      "node_modules/@getpaseo/cli/dist/index.js",
      "daemon",
      "run",
      "--home",
      home,
    ],
    {
      env: {
        ...process.env,
        PASEO_HOME: home,
        PASEO_LISTEN: host,
        PASEO_NODE_ENV: "development",
        PASEO_DICTATION_ENABLED: "false",
        PASEO_VOICE_MODE_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output = (output + data.toString()).slice(-16000);
  });
  child.stderr.on("data", (data: Buffer) => {
    output = (output + data.toString()).slice(-16000);
  });
  const exited = new Promise<void>((ok) => child.once("exit", () => ok()));
  async function stop() {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await exited;
    await rm(home, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 30000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Daemon exited: ${output}`);
      try {
        const attempt = connect({ kind: "host", connection: host });
        const result = await Promise.race([
          attempt.then((connection) => ({
            kind: "connected" as const,
            connection,
          })),
          exited.then(() => ({ kind: "exited" as const })),
          delay(Math.max(0, deadline - Date.now()), undefined, {
            ref: false,
          }).then(() => ({
            kind: "timeout" as const,
          })),
        ]);
        if (result.kind !== "connected") {
          void attempt.then(
            (connection) => connection.close(),
            () => {},
          );
          if (result.kind === "exited")
            throw new Error(`Daemon exited: ${output}`);
          break;
        }
        await result.connection.close();
        return { host, home, stop };
      } catch (error) {
        lastError = error;
      }
      await Promise.race([delay(50), exited]);
    }
    throw new Error(
      `Daemon startup timed out: ${String(lastError)}\n${output}`,
    );
  } catch (error) {
    await stop();
    throw error;
  }
}
