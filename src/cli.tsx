#!/usr/bin/env -S NODE_ENV=production node --experimental-ffi --no-warnings=ExperimentalWarning
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { type CliRendererConfig, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { ReactNode } from "react";
import packageJson from "../package.json" with { type: "json" };
import { connect } from "./connection/connect.js";
import { resolveTarget } from "./connection/target.js";
import { isEntryPoint } from "./entry-point.js";
import {
  type ConnectedHost,
  connectedHost,
  createHosts,
  type LiveHost,
} from "./hosts.js";
import { createMultiHost, windowLabel } from "./multi-host.js";
import { hostsPath, loadHostRegistry } from "./state/host-registry.js";
import { App } from "./ui/App.js";
import {
  filePreferenceStorage,
  loadThinkingPreference,
  thinkingPreferencePath,
} from "./ui/agent/thinking-preference.js";
import { createCommandRegistry } from "./ui/command-center/registry.js";
import { loadUserConfig, userConfigPath } from "./ui/config/user-config.js";
import { nodeClipboardRunner, systemClipboard } from "./ui/copy/clipboard.js";
import { nodeBrowserRunner, systemBrowser } from "./ui/file-links/browser.js";
import { positionModifiers } from "./ui/input/bindings.js";
import { parsePrefix } from "./ui/input/keymap.js";
import { createModifierHold } from "./ui/input/modifier-hold.js";
import {
  layoutsPath,
  loadLayoutMemory,
  timerSchedule,
} from "./ui/layout/layout-memory.js";
import {
  notificationSequence,
  parseNotifyStyle,
} from "./ui/notify/terminal-notification.js";
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
import { useStore } from "./ui/use-store.js";
import { resolveDiffTool } from "./ui/workspace/diff-tool.js";
import { DEFAULT_EDITOR } from "./ui/workspace/workspace-editor.js";

const HELP = `Usage: paseo-tui [options]

Terminal client for a Paseo daemon.

Options:
  --host <target>  Daemon address or SSH target (default: PASEO_HOST, or the local daemon)
  --home <dir>     Paseo home of the local daemon (default: PASEO_HOME or ~/.paseo)
  --config <path>  Config file (default: $XDG_CONFIG_HOME/paseo-tui/config.json,
                   else ~/.config/paseo-tui/config.json)
  --prefix <key>   Pane prefix, C-<letter> (default: config prefix, else C-b)
  --no-mouse       Disable mouse input
  --notify <how>   Alert when an agent needs you: osc9, osc777, bell, or off
                   (default: config notify, else osc9)
  --diff-tool <cmd> Command g d runs in a workspace tab
                   (default: PASEO_TUI_DIFF_TOOL or lazygit)
  -h, --help       Show help
  -v, --version    Show version

Environment: PASEO_TUI_KEY_LOG=<file> logs every key the terminal sends
(raw bytes and how it parsed), to debug shortcuts that don't fire.

Config keys: "keys" (rebind actions), "theme" (hex color overrides), "prefix",
"notify". Layouts are saved in $XDG_STATE_HOME/paseo-tui/layouts.json.
`;

/**
 * Kitty keyboard reporting of modifier-only keys and releases lets a held
 * Cmd/Alt show jump hints; `modifierInput` swallows those keys first.
 */
export function rendererOptions(
  values: { mouse?: boolean },
  modifierInput?: (sequence: string) => boolean,
): CliRendererConfig {
  return {
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    useMouse: values.mouse !== false,
    targetFps: 60,
    useKittyKeyboard: { events: true, allKeysAsEscapes: true },
    ...(modifierInput ? { prependInputHandlers: [modifierInput] } : {}),
  };
}

type Hosts = ReturnType<typeof createHosts<ConnectedHost>>;
/** Re-renders with the connected hosts, for the status bar label. */
function HostWindow({
  hosts,
  children,
}: {
  hosts: Hosts;
  children(live: readonly LiveHost<ConnectedHost>[]): ReactNode;
}) {
  return children(useStore(hosts));
}

/** `PASEO_TUI_KEY_LOG=<file>`: what the terminal sends and how it parses, to debug shortcuts. */
function logKey(path: string, entry: Record<string, unknown>) {
  appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

async function main() {
  const { values } = parseArgs({
    allowNegative: true,
    options: {
      prefix: { type: "string" },
      config: { type: "string" },
      mouse: { type: "boolean", default: true },
      host: { type: "string" },
      home: { type: "string" },
      notify: { type: "string" },
      "diff-tool": { type: "string" },
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

  const configFile = values.config ?? userConfigPath(process.env, homedir());
  const config = await loadUserConfig(
    filePreferenceStorage(configFile),
    configFile,
    values.config !== undefined,
  );
  const prefix = parsePrefix(values.prefix ?? config.prefix ?? "C-b");
  const notifyStyle = parseNotifyStyle(values.notify ?? config.notify);
  const layouts = await loadLayoutMemory(
    filePreferenceStorage(layoutsPath(process.env, homedir())),
    { schedule: timerSchedule },
  );
  const diffTool = resolveDiffTool(values["diff-tool"], process.env);
  const target = resolveTarget(
    { host: values.host, home: values.home },
    process.env,
  );
  const thinkingPreference = await loadThinkingPreference(
    filePreferenceStorage(thinkingPreferencePath(process.env, homedir())),
  );
  const hostsFile = hostsPath(process.env, homedir());
  const hosts = createHosts({
    initial: { target, live: connectedHost(await connect(target)) },
    registry: await loadHostRegistry(
      filePreferenceStorage(hostsFile),
      hostsFile,
    ),
    open: async (saved, label, password) =>
      connectedHost(await connect(saved, label, password)),
  });
  const merged = createMultiHost(hosts);
  const local = merged.local;
  const commands = createCommandRegistry();
  const positionHints = createModifierHold(
    positionModifiers(process.platform).map((modifier) =>
      modifier === "Super" ? "super" : "alt",
    ),
  );
  const keyLog = process.env.PASEO_TUI_KEY_LOG;
  const renderer = await createCliRenderer(
    rendererOptions(values, (sequence) => {
      if (keyLog) logKey(keyLog, { raw: sequence });
      return positionHints.input(sequence);
    }),
  );
  renderer.on("blur", positionHints.reset);
  if (keyLog)
    renderer.keyInput.on("keypress", (key) =>
      logKey(keyLog, {
        name: key.name,
        sequence: key.sequence,
        ctrl: key.ctrl,
        meta: key.meta,
        shift: key.shift,
        super: key.super ?? false,
        source: key.source,
      }),
    );
  const theme = createTheme(process.env, config.theme);
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
        <HostWindow hosts={hosts}>
          {(live) => (
            <App
              label={windowLabel(live)}
              connection={local.status}
              agents={merged.agents}
              directory={merged.directory}
              terminals={merged.terminals}
              terminalStream={merged.terminalStream}
              thinkingPreference={thinkingPreference}
              management={merged.management}
              clearAttention={merged.clearAttention}
              refresh={merged.refresh}
              catalog={merged.catalog}
              timelines={merged.timelines}
              commands={commands}
              hosts={hosts.port}
              onActiveWorkspace={merged.focus}
              prefix={prefix}
              bindings={config.bindings}
              layouts={layouts}
              completions={merged.completions}
              directories={merged.directories}
              systemClipboard={systemClipboard(
                process.platform,
                process.env,
                nodeClipboardRunner,
              )}
              browser={systemBrowser(process.platform, nodeBrowserRunner)}
              isRemoteAgent={merged.isRemoteAgent}
              subagents={merged.subagents}
              diffTool={diffTool}
              editor={config.editor ?? DEFAULT_EDITOR}
              usage={local.usage}
              usageConfig={config.usage}
              schedules={local.schedules}
              history={merged.history ?? undefined}
              positionHints={positionHints}
              notify={
                notifyStyle === "off"
                  ? undefined
                  : (notification) => {
                      process.stdout.write(
                        notificationSequence(
                          notifyStyle,
                          notification,
                          process.env,
                        ),
                      );
                    }
              }
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
          )}
        </HostWindow>
      </ThemeContext>,
    );
    await renderer.closed;
  } finally {
    renderer.destroy();
    await renderer.closed;
    syntaxStyle.destroy();
    process.off("uncaughtException", uncaught);
    merged.timelines.close();
    await hosts.close();
    await thinkingPreference.flush();
    await layouts.flush();
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
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
