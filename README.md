# paseo-tui

A full-screen terminal client for Paseo, built with TypeScript, OpenTUI and React. It groups agents by workspace and supports live timelines, prompts, permission answers, split panes, embedded terminals and a Command Center.

## Requirements

- Node 26.4 or newer (OpenTUI needs `--experimental-ffi`); `.nvmrc` and `.tool-versions` pin 26.13.0.
- A running Paseo daemon. The client only reads and steers it.

## Getting started

```sh
asdf install nodejs 26.13.0   # or: nvm use
npm install
npm run dev
```

### Options

Pass options after `--`, for example `npm run dev -- --host <target>`.

| Option            | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `--host <target>` | Daemon address or SSH target (default: `PASEO_HOST`, else local)     |
| `--home <dir>`    | Paseo home of the local daemon (default: `PASEO_HOME` or `~/.paseo`) |
| `--prefix <key>`  | Pane prefix, `C-<letter>` only (default: `C-b`)                      |
| `--no-mouse`      | Disable mouse input                                                  |
| `-h`, `--help`    | Show help                                                            |
| `-v`, `--version` | Show version                                                         |

Set `NO_COLOR=1` for terminal-default colors.

## Development

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `npm run dev`              | Run from source                                 |
| `npm run typecheck`        | Type-check with `tsc`                           |
| `npm run lint`             | Lint and format-check with Biome                |
| `npm test`                 | Unit tests (Vitest)                             |
| `npm run test:integration` | Tests against an isolated, spawned Paseo daemon |
| `npm run build`            | Compile to `dist/`                              |

Run the build with `node --experimental-ffi dist/cli.js`. CI runs typecheck, lint, unit tests and build on every push and pull request.

Tests live beside their implementation as `*.test.ts` / `*.test.tsx` and are excluded from the build. Shared test helpers live in `src/test/`.

### Project layout

```text
src/
  cli.tsx        entry point: flags, renderer, wiring
  session.ts     composes connection, state stores and UI controllers
  connection/    daemon client adapter and the port types it implements
  state/         agent, timeline and subagent stores
  ui/            OpenTUI + React; logic in plain TS modules, components stay thin
  test/          fixtures, the App test harness and the integration daemon
```

Imports only point downward, `ui/` → `state/` → `connection/`, and Biome enforces it.

## Keybindings

The UI starts in normal mode. `i` or `a` in a timeline enters insert mode; `Esc` returns to normal. `?` shows the same binding table in the app.

| Context                    | Key                                        | Action                                |
| -------------------------- | ------------------------------------------ | ------------------------------------- |
| Normal                     | `\`                                        | Toggle sidebar                        |
| Normal                     | `q`                                        | Quit                                  |
| Any mode                   | `Ctrl-C`                                   | Quit                                  |
| Normal                     | `?`                                        | Help                                  |
| Normal                     | `Tab`                                      | Switch sidebar/pane                   |
| Command Center             | `New agent…`                               | Create in an existing workspace       |
| Command Center             | `Set mode…`                                | Pick an available mode                |
| Command Center             | `Set model…`                               | Pick a model (with catalog access)    |
| Command Center             | `Rename…`                                  | Edit the agent title                  |
| Command Center             | `Archive…`                                 | Confirm with `y` or click Confirm     |
| Normal pane                | `Shift-Tab`                                | Cycle agent mode                      |
| Normal                     | `Ctrl-X`                                   | Stop running turn                     |
| Sidebar                    | `j` / `↓`                                  | Next agent                            |
| Sidebar                    | `k` / `↑`                                  | Previous agent                        |
| Sidebar                    | `g g`                                      | First agent                           |
| Sidebar                    | `G`                                        | Last agent                            |
| Sidebar                    | `Enter` / `l`                              | Open agent                            |
| Pane                       | `j` / `↓`                                  | Scroll down                           |
| Pane                       | `k` / `↑`                                  | Scroll up                             |
| Pane                       | `Ctrl-d` / `Ctrl-u`                        | Half page down / up                   |
| Pane                       | `Ctrl-f` / `PgDn`                          | Page down                             |
| Pane                       | `PgUp` (also `Ctrl-b` with another prefix) | Page up                               |
| Pane                       | `g g`                                      | History top                           |
| Pane                       | `G`                                        | Bottom and follow                     |
| Pane                       | `{` / `}`                                  | Previous / next expandable block      |
| Pane                       | `o` / `Enter`                              | Toggle selected block                 |
| Pane                       | `O`                                        | Expand/collapse all                   |
| Pane                       | `i` / `a`                                  | Edit prompt                           |
| Pane                       | `Esc`                                      | Focus sidebar                         |
| Insert                     | `Esc`                                      | Leave insert mode and discard prompt  |
| Insert                     | `Enter`                                    | Send prompt                           |
| Insert                     | `Shift-Enter` / `Ctrl-J`                   | Newline                               |
| Insert                     | Arrows / `Home` / `End`, paste             | Edit text, preserving multiline paste |
| Permission with actions    | `1`–`9`                                    | Choose action                         |
| Permission without actions | `y` / `n`                                  | Allow / deny                          |
| Question without actions   | `n`                                        | Deny; answer in the app               |
| Permission                 | `Esc`                                      | Defer; reopen the agent to return     |
| Help                       | `?` / `Esc`                                | Close help                            |

New permissions for the open agent take focus automatically. In insert mode, shortcuts such as `q` and `?` are text. Shift-Enter requires a terminal that reports modified keys; Ctrl-J also inserts a newline.

### Mouse

Click an agent to select it and click the selected row to open it. Click tool and reasoning headers to expand them; the mouse wheel scrolls the timeline.

### Timeline details

Tool details include shell output (last 200 lines), file content (first 400 lines) and edit diffs. Unknown timeline types remain visible as `[type]`.

## Split panes and search

`Ctrl-B` is the default pane prefix in both normal and insert mode; inside tmux, use `--prefix C-a`. Prefix mode expires after 1500 ms, and an unbound key consumes it. Repeat the prefix in insert mode to insert its literal control character.

| Context      | Key                           | Action                                          |
| ------------ | ----------------------------- | ----------------------------------------------- |
| Prefix       | `%` / `"`                     | Split right / down, copying the focused agent   |
| Prefix       | `h` / `j` / `k` / `l`, arrows | Focus left / down / up / right                  |
| Prefix       | `o`                           | Next pane                                       |
| Prefix       | `x`                           | Close view; closing the last pane empties it    |
| Prefix       | `z`                           | Zoom / unzoom                                   |
| Prefix       | `q`                           | Show pane numbers for one second; digit selects |
| Prefix       | `0`–`9`                       | Select pane by zero-based index                 |
| Prefix       | `?`                           | Help                                            |
| Normal       | `Ctrl-w h/j/k/l` / `Ctrl-w w` | Focus direction / next pane                     |
| Pane, normal | `/`                           | Search loaded timeline blocks                   |
| Search       | `Enter` / `Esc`               | Commit / cancel query                           |
| Pane, normal | `n` / `N`                     | Next / previous match, wrapping                 |

Opening an agent assigns it to the focused pane. Click any pane to focus it. Panes showing the same agent share one live timeline subscription, while selection, search and expanded details stay separate. Splits, closing and focus changes clear zoom. Layouts are not persisted.

Search is a case-insensitive substring match over loaded history, including collapsed tool output and reasoning. A jump selects the matching block, expands its detail and scrolls it into view. The status bar shows `match i/n` or `no match`.

## Command Center

Press `Ctrl-K` in any mode, or `:` in normal mode (also after the prefix), to search agents, workspaces, pane actions, view actions and keyboard help.

- Search accepts multiple tokens and fuzzy subsequences.
- Use arrows or `Ctrl-N` / `Ctrl-P` to select, then `Enter` to run; clicking a result also runs it.
- `Esc` goes back a step, or closes at the root; a click outside closes the palette.
- Opening it from insert mode restores insert mode on close.
- Agent commands can open in the focused pane or in a new split on the right.
- The focused agent also has Stop (while running) and separate Expand all / Collapse all commands (`O` still toggles both).
- Additional command sources can register with the shared registry.

### Managing agents

For the focused agent, the Command Center offers **Set mode…**, **Rename…** and **Archive…** (confirm with `y` or click Confirm). **Set model…** appears when catalog access is supplied. Mode choices mark the current mode; model choices mark the current and default models.

### Creating agents

With catalog access, **New agent…** picks a provider, model and mode, followed by an optional title and first prompt. It uses the focused agent's workspace; from an empty pane it first asks for an existing workspace. Default models and modes appear first, and an empty title lets the daemon name the agent.

The focused pane shows `Loading…` for up to ten seconds while it waits for the new agent's snapshot. Creation errors appear in the status bar for five seconds.
