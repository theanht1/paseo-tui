#!/usr/bin/env -S NODE_ENV=production node --experimental-ffi --no-warnings=ExperimentalWarning
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type CliRendererConfig, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import packageJson from "../package.json" with { type: "json" };
import { connect } from "./connection/connect.js";
import { resolveTarget } from "./connection/target.js";
import { createSession } from "./session.js";
import { App } from "./ui/App.js";
import {
  filePreferenceStorage,
  loadThinkingPreference,
  thinkingPreferencePath,
} from "./ui/agent/thinking-preference.js";
import { createCommandRegistry } from "./ui/command-center/registry.js";
import { nodeClipboardRunner, systemClipboard } from "./ui/copy/clipboard.js";
import { parsePrefix } from "./ui/input/keymap.js";
import {
  editExternally,
  nodeEditorFiles,
  nodeEditorSpawn,
} from "./ui/prompt/external-editor.js";
import {
  createSyntaxStyle,
  createTheme,
  ThemeContext,
} from "./ui/render/theme.js";

const HELP = `Usage: paseo-tui [options]

Terminal client for a Paseo daemon.

Options:
  --host <target>  Daemon address or SSH target (default: PASEO_HOST, or the local daemon)
  --home <dir>     Paseo home of the local daemon (default: PASEO_HOME or ~/.paseo)
  --prefix <key>  Pane prefix, C-<letter> (default: C-b)
  --no-mouse      Disable mouse input
  -h, --help       Show help
  -v, --version    Show version
`;

export function rendererOptions(values: {
  mouse?: boolean;
}): CliRendererConfig {
  return {
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useMouse: values.mouse !== false,
    targetFps: 60,
  };
}

async function main() {
  const { values } = parseArgs({
    allowNegative: true,
    options: {
      prefix: { type: "string", default: "C-b" },
      mouse: { type: "boolean", default: true },
      host: { type: "string" },
      home: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    process.stdout.write(`${packageJson.version}\n`);
    return;
  }
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const prefix = parsePrefix(values.prefix);
  const target = resolveTarget(
    { host: values.host, home: values.home },
    process.env,
  );
  const thinkingPreference = await loadThinkingPreference(
    filePreferenceStorage(thinkingPreferencePath(process.env, homedir())),
  );
  const connection = await connect(target);
  const session = createSession(connection);
  const { agentsPort, agents, status, timelines } = session;
  const commands = createCommandRegistry();
  const renderer = await createCliRenderer(rendererOptions(values));
  const theme = createTheme(process.env);
  const syntaxStyle = createSyntaxStyle(renderer, theme);
  function uncaught(error: Error) {
    renderer.destroy();
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
  process.on("uncaughtException", uncaught);
  try {
    createRoot(renderer).render(
      <ThemeContext value={{ theme, syntaxStyle }}>
        <App
          label={connection.label}
          connection={status}
          agents={agents}
          directory={session.directory}
          terminals={session.terminals}
          terminalStream={session.terminalStream}
          thinkingPreference={thinkingPreference}
          management={session.management}
          clearAttention={session.clearAttention}
          refresh={session.refresh}
          catalog={agentsPort}
          timelines={timelines}
          commands={commands}
          prefix={prefix}
          completions={connection.completions}
          directories={connection.directories}
          systemClipboard={systemClipboard(
            process.platform,
            process.env,
            nodeClipboardRunner,
          )}
          subagents={session.subagents}
          editPrompt={(text, host) =>
            editExternally(text, {
              env: process.env,
              host,
              files: nodeEditorFiles(),
              spawn: nodeEditorSpawn,
            })
          }
          onExit={() => renderer.destroy()}
        />
      </ThemeContext>,
    );
    await renderer.closed;
  } finally {
    renderer.destroy();
    await renderer.closed;
    syntaxStyle.destroy();
    process.off("uncaughtException", uncaught);
    await session.close();
    await connection.close();
    await thinkingPreference.flush();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    },
  );
}
