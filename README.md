# paseo-tui

A full-screen terminal client for Paseo, built with TypeScript, OpenTUI and React. It groups agents by workspace and supports live timelines, prompts, permission answers, split panes, embedded terminals and a Command Center.

## Requirements

- **Node 26.4 or newer.** OpenTUI needs Node's `--experimental-ffi`, which older versions lack; the installed `paseo-tui` command passes the flag for you. Check with `node --version`.
- macOS, Linux (glibc or musl) or Windows, on x64 or arm64.
- A running [Paseo](https://github.com/getpaseo/paseo) daemon, version 0.15.x. The client only reads and steers it; it never starts or stops the daemon.

## Install

```sh
npm install -g paseo-tui
paseo-tui
```

Or run it once without installing: `npx paseo-tui`. With no options it connects to the local daemon (`~/.paseo`); see `paseo-tui --help`.

### Options

| Option              | Description                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `--host <target>`   | Daemon address or SSH target (default: `PASEO_HOST`, else local)                                        |
| `--home <dir>`      | Paseo home of the local daemon (default: `PASEO_HOME` or `~/.paseo`)                                    |
| `--config <path>`   | Config file (default: `$XDG_CONFIG_HOME/paseo-tui/config.json`, else `~/.config/paseo-tui/config.json`) |
| `--prefix <key>`    | Pane prefix, `C-<letter>` only (default: config `prefix`, else `C-b`)                                   |
| `--no-mouse`        | Disable mouse input                                                                                     |
| `--notify <how>`    | Alert when an agent needs you: `osc9`, `osc777`, `bell`, `off` (default: config `notify`, else `osc9`)  |
| `--diff-tool <cmd>` | Tool `g d` opens (default: `PASEO_TUI_DIFF_TOOL`, else `lazygit`)                                       |
| `-h`, `--help`      | Show help                                                                                               |
| `-v`, `--version`   | Show version                                                                                            |

Set `NO_COLOR=1` for terminal-default colors.

### Configuration

The optional config file is JSON. Flags override `prefix` and `notify`; any problem (unknown setting or action, bad key or color, key conflict) stops startup with a list of every issue.

The optional `editor` setting (default `nvim`) is the command `g e` (or **Open workspace in editor** in the Command Center) runs as `sh -c "<editor> ."` in a terminal tab in the selected workspace's directory on the daemon host, so it may carry arguments, e.g. `{ "editor": "code -w" }`. If an editor tab is already open there, `g e` focuses it.

```json
{
  "prefix": "C-a",
  "notify": "bell",
  "keys": {
    "sidebar.toggle": "|",
    "pane.split:right": ["%", "v"],
    "tab.create": "Ctrl-t",
    "subagents.open": []
  },
  "theme": {
    "accent": "#ff9e64",
    "borderFocused": "#ff9e64",
    "status": { "running": "#7aa2f7" },
    "syntax": { "keyword": "#bb9af7" },
    "heading": ["#ff9e64", "#7dcfff", "#9ece6a"]
  }
}
```

- `keys` maps an action to a key or a list of keys, replacing its defaults; `[]` unbinds it. Actions are named by their type plus arguments joined with `:`, for example `help`, `palette.open`, `pane.split:right`, `pane.focus:left`, `pane.select:3`, `tab.select:0`, `workspace.cycle:-1`, `scroll.half:1`, `list.edge:top`; an unknown name prints the full list. Keys use the help popup's format: `x`, `X`, `Ctrl-x`, `Meta-x` (or `Alt-x`), `Enter`, `Esc`, `Tab`, `Shift-Tab`, `Up`, `PgDn`, `F1`. A rebound action keeps its default modes, so prefix actions still follow the prefix and always-on actions (`tab.create`, `palette.open`) need a `Ctrl-` or `Meta-` key. Multi-key chords cannot be bound; `Ctrl-C`, `Z Q`, `g t` / `g T`, `Ctrl-w <dir>`, and `g` / `Z` / `Ctrl-w` in normal mode stay fixed. The help popup, status hints and Command Center show the effective keys.
- `theme` overrides colors with hex values (`#rgb`, `#rrggbb`, `#rrggbbaa`): top-level fields (`fg`, `muted`, `faint`, `accent`, `user`, `userBg`, `assistant`, `tool`, `reasoning`, `error`, `warn`, `success`, `border`, `borderFocused`, `selectionBg`, `cursorBg`, `cursorFg`, `codeBg`, `copySelectionBg`, `copySelectionFg`, `copyCursorBg`, `copyCursorFg`), `status` (`running`, `idle`, `error`, `attention`, `question`), `syntax` (highlight styles such as `keyword`, `string`, `comment`) and up to three `heading` levels. `NO_COLOR` still wins.

The optional `usage` setting picks which provider meters the status bar shows, in the order listed: `true` keeps a provider's default window, an array of window, balance or detail ids shows exactly those, and `false` hides it. Without `usage`, every reporting provider shows its default window. The Command Center's "Provider usage" view still lists everything and ends each row with `id <provider>.<id>`, plus `· hidden` when `usage` leaves it out of the status bar:

```json
{
  "usage": {
    "claude": ["five_hour", "seven_day"],
    "codex": true,
    "openrouter": false
  }
}
```

Each workspace remembers its split layout, the agent in each pane, zoom and the selected tab when you leave it, and again after a restart. Layouts are saved to `$XDG_STATE_HOME/paseo-tui/layouts.json` (else `~/.local/state/paseo-tui/layouts.json`); panes whose agents no longer exist are dropped on restore.

## Hosts and projects

One window can show several Paseo daemons. `--host` (or the local daemon) is the first host; every host saved with **Add host…** in the Command Center also connects at startup. Projects from all hosts are merged by repository, as in the desktop app, and each workspace row is tagged with its host. Actions go to the host that owns the agent, workspace or terminal.

- **Add host…** asks for an address (`host:port`, `tcp://host:port` or `ssh://user@host`), a name, and the daemon's `PASEO_PASSWORD` (Enter for none).
- **Hosts…** lists every host with its status; pick an offline host to reconnect it.
- Saved hosts live in `$XDG_CONFIG_HOME/paseo-tui/hosts.json` (else `~/.config/paseo-tui/hosts.json`). Passwords are stored there in plain text, in a file readable only by you (mode `0600`). A `?password=` typed into an address is moved out of the address so it is never shown or logged.
- **Add project…** picks a host and finds a directory on it. **Remove project…** archives the project's workspaces and deletes their worktrees, after you confirm.
- **New workspace…** picks a project, then a host when the project is on several, then Local or Worktree (a new git worktree from a base branch).

## Development

```sh
git clone https://github.com/theanht1/paseo-tui.git && cd paseo-tui
asdf install nodejs 26.13.0   # or: nvm use (.nvmrc and .tool-versions pin 26.13.0)
npm install
npm run dev
```

| Command                    | Purpose                                         |
| -------------------------- | ----------------------------------------------- |
| `npm run dev`              | Run from source                                 |
| `npm run typecheck`        | Type-check with `tsc`                           |
| `npm run lint`             | Lint and format-check with Biome                |
| `npm test`                 | Unit tests (Vitest)                             |
| `npm run test:integration` | Tests against an isolated, spawned Paseo daemon |
| `npm run build`            | Compile to `dist/`                              |

Pass options to the dev build after `--`, for example `npm run dev -- --host <target>`. Run the compiled build with `npm start` (or `node --experimental-ffi dist/cli.js`). CI runs typecheck, lint, unit tests and build on every push and pull request.

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

| Context                    | Key                                        | Action                                          |
| -------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Normal                     | `\`                                        | Toggle sidebar                                  |
| Normal                     | `Ctrl-C` twice within 2 s                  | Quit (warns about queued messages)              |
| Insert, search, palette    | `Ctrl-C`                                   | Leave the input, keeping the draft              |
| Normal                     | `?`                                        | Help                                            |
| Normal                     | `Tab`                                      | Switch sidebar/pane                             |
| Command Center             | `New agent…`                               | Create in an existing workspace                 |
| Command Center             | `Set mode…`                                | Pick an available mode                          |
| Command Center             | `Set model…`                               | Pick a model (with catalog access)              |
| Command Center             | `Set thinking…`                            | Pick a thinking option                          |
| Command Center             | `Jump to prompt…`                          | Scroll the pane to an earlier prompt            |
| Command Center             | `Rewind to prompt…`                        | Undo back to before a prompt                    |
| Command Center             | `Fork from prompt…`                        | New agent from earlier history                  |
| Command Center             | `Rename…`                                  | Edit the agent title                            |
| Command Center             | `Archive…`                                 | Confirm with `y` or click Confirm               |
| Normal pane                | `Shift-Tab`                                | Cycle agent mode                                |
| Normal or insert           | `Ctrl-X`                                   | Stop running turn (again retries a slow stop)   |
| Normal                     | `U`                                        | Jump to next agent that needs you               |
| Normal                     | `S`                                        | Group sidebar by project / status               |
| Normal                     | `]` / `[`                                  | Next / previous workspace                       |
| Normal                     | `1`–`9`                                    | Select tab by position                          |
| Normal                     | `g d`                                      | Open changes in lazygit (a tab)                 |
| Normal                     | `g e`                                      | Open workspace in editor                        |
| Normal                     | `H`                                        | Session history                                 |
| Normal pane                | `t`                                        | Jump to a prompt in this session                |
| Normal pane                | `F`                                        | Open a file (vim tab) or link (browser) by hint |
| Normal pane                | `u`                                        | Unarchive agent                                 |
| Normal or insert           | `Alt-1`–`Alt-9`                            | Open workspace by sidebar position              |
| Sidebar                    | `j` / `↓`                                  | Next agent                                      |
| Sidebar                    | `k` / `↑`                                  | Previous agent                                  |
| Sidebar                    | `g g`                                      | First agent                                     |
| Sidebar                    | `G`                                        | Last agent                                      |
| Sidebar                    | `Enter` / `l`                              | Open agent                                      |
| Pane                       | `j` / `↓`                                  | Scroll down                                     |
| Pane                       | `k` / `↑`                                  | Scroll up                                       |
| Pane                       | `Ctrl-d` / `Ctrl-u`                        | Half page down / up                             |
| Pane                       | `Ctrl-f` / `PgDn`                          | Page down                                       |
| Pane                       | `PgUp` (also `Ctrl-b` with another prefix) | Page up                                         |
| Pane                       | `g g`                                      | History top                                     |
| Pane                       | `G`                                        | Bottom and follow                               |
| Pane                       | `{` / `}`                                  | Previous / next expandable block                |
| Pane                       | `o` / `Enter`                              | Toggle selected block                           |
| Pane                       | `O`                                        | Expand/collapse all                             |
| Pane                       | `i` / `a`                                  | Edit prompt                                     |
| Pane                       | `Esc`                                      | Focus sidebar                                   |
| Insert                     | `Esc`                                      | Leave insert mode, keeping the draft            |
| Insert                     | `Enter`                                    | Send prompt; queue it while the agent works     |
| Insert, messages queued    | `Ctrl-S`                                   | Send the queued message now (steer)             |
| Insert, messages queued    | `Ctrl-R`                                   | Move the queued message into the prompt         |
| Insert, messages queued    | `Ctrl-O`                                   | Remove the queued message                       |
| Insert, messages queued    | `Ctrl-Up` / `Ctrl-Down`                    | Select a queued message                         |
| Command Center             | `Interrupt and send queued message`        | Stop the turn and send the message instead      |
| Command Center             | `Clear message queue`                      | Drop every queued message                       |
| Insert                     | `Shift-Enter` / `Ctrl-J`                   | Newline                                         |
| Insert                     | Arrows / `Home` / `End`, paste             | Edit text, preserving multiline paste           |
| Permission with actions    | `1`–`9`                                    | Choose action                                   |
| Permission without actions | `y` / `n`                                  | Allow / deny                                    |
| Question without actions   | `n`                                        | Deny; answer in the app                         |
| Permission or question     | `m`, type, `Enter`                         | Steer: reply with a message instead             |
| Permission                 | `Esc`                                      | Defer; reopen the agent to return               |
| Help                       | `?` / `Esc`                                | Close help                                      |

Plan approvals show the proposed plan as markdown (`↑`/`↓` scroll it; `y` implements, `n` rejects). Instead of answering any permission, plan or question, press `m` to type a message: it is sent into the running turn (`activeTurnBehavior: "steer"`), the daemon denies the pending request, and the agent continues with your message, as in the Paseo app. `Esc` or `Ctrl-C` closes the message field. A plan you rejected or steered past stays in the timeline as a collapsed "Rejected plan" block (`}` then `o` expands it); this row comes from the daemon, so it survives reloads.

New permissions for the open agent take focus automatically.

While the agent works, `Enter` adds the message to a queue shown above the prompt instead of sending it. When the turn ends, the oldest queued message goes out, one per turn. After a failed or stopped turn the queue pauses ("Queue paused · Enter to resume"); `Enter` on an empty prompt resumes it. The queue lives in the TUI only (the daemon has no queue to list or edit), so quitting asks for a second `Ctrl-C` and says how many queued messages would be lost. `Ctrl-X` shows "Stopping…" at once; if the daemon has taken the stop but the turn has not ended after about five seconds, press `Ctrl-X` again to retry.

`t` (or **Jump to prompt…** in the Command Center) lists every prompt of the session, newest first, from the daemon's prompt index; picking one pages older history in when needed and selects and expands that message. It needs a daemon with `agentTimelinePromptIndex`.

`F` labels the file paths and `http(s)` links on screen. A file opens in a vim tab on the daemon host; a link opens in the default browser of the machine running the TUI (`open`, `xdg-open` or `rundll32`, started without a shell), so a `localhost` link from an agent on a remote host refers to this machine. Clicking a link and `g f` in copy mode do the same.

`g d` (or **Open changes (lazygit)** in the Command Center) runs the diff tool in a terminal tab in the selected workspace's directory, or focuses its tab if one is already open there. Quitting the tool closes the tab and returns to the tab you came from. Pick another tool with `--diff-tool "tig status"` or `PASEO_TUI_DIFF_TOOL`; the command runs through `sh -c` on the daemon host.

### Agents that need you

Sidebar rows show the most urgent status of their workspace (`?` question, `!` permission with a count when more than one is pending, a spinner while running, `●` for an unread finished or failed turn) and a dim line with the branch, unpushed commits, diff size and PR checks, plus `setup…`, `setup failed` or `setup blocked` while a new worktree's `paseo.json` setup needs a look. `S` regroups the sidebar into Needs input, Failed, Running, Unread and Idle; `U` walks agents waiting on you, most urgent first; the Command Center lists them under **Needs you**.

When an agent starts waiting and you are not looking at it (another agent is open, or the terminal is unfocused), the TUI raises a desktop notification. OSC 9 works in iTerm2, WezTerm, Ghostty, kitty and Windows Terminal; use `--notify osc777` for foot or VTE terminals, or `bell`. Inside tmux, sequences use passthrough, which needs `set -g allow-passthrough on`. In insert mode, shortcuts such as `q` and `?` are text. Shift-Enter requires a terminal that reports modified keys; Ctrl-J also inserts a newline.

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
| Pane, normal | `/`                           | Search the timeline, including unloaded history |
| Search       | `Enter` / `Esc`               | Commit / cancel query                           |
| Pane, normal | `n` / `N`                     | Next / previous match, wrapping                 |

Opening an agent assigns it to the focused pane. Click any pane to focus it. Panes showing the same agent share one live timeline subscription, while selection, search and expanded details stay separate. Splits, closing and focus changes clear zoom. Layouts are saved per workspace (see [Configuration](#configuration)).

Search is a case-insensitive substring match over loaded history, including collapsed tool output and reasoning. When the daemon advertises `agentHistorySearch`, committing a query also searches the agent's whole chat on the daemon, so messages older than the loaded window count too; `n` / `N` page older history in to reach them, and a query with no loaded match jumps to the newest daemon match. Matches are ordered oldest first. A jump selects the matching block, expands its detail and scrolls it into view. The status bar shows `match i/n` (`n+` when the daemon capped the results, plus `searching history…` while it runs) or `no match`.

### Copy mode

Prefix `[` enters tmux-style copy mode over the pane's whole history, as in tmux with vi keys: `h` `j` `k` `l`, `w` `b` `e`, `0` `^` `$`, `g g` / `G`, `H` `M` `L`, `f` / `t` jumps, `/` `?` `n` `N` `*` `#` search, `Ctrl-u` / `Ctrl-d` paging, counts, and `v` / `V` / `Space` to start a selection. `y` or `Enter` copies to the system clipboard (and OSC 52, so it also works over SSH); `Esc` clears the selection, then leaves; `q` leaves at once. The mouse wheel scrolls, and selecting with the mouse copies too.

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

These appear only when the daemon advertises their `server_info` features; update the daemon to get the ones that are missing:

- **Set thinking…** (`agentThinkingUpdate`, with catalog access) lists the thinking options of the agent's model, marking the current and default ones.
- **Rewind to prompt…** (`rewind` and `agentTimelinePromptIndex`) lists earlier prompts, newest first. Pick one, pick conversation, files or both (only the modes the provider supports), then confirm. The agent returns to the state before that prompt.
- **Fork from prompt…** (`agentForkContext`, `agentForkContextCursor` and `agentTimelinePromptIndex`, for agents with a known model) creates a new agent with the same provider, model, mode, thinking and directory. It gets the chat history before the chosen prompt as context. Type a new prompt, or leave it empty to resend the chosen one.

### Creating agents

With catalog access, **New agent…** picks a provider, model and mode, followed by an optional title and first prompt. It uses the focused agent's workspace; from an empty pane it first asks for an existing workspace. Default models and modes appear first, and an empty title lets the daemon name the agent.

The focused pane shows `Loading…` for up to ten seconds while it waits for the new agent's snapshot. Creation errors appear in the status bar for five seconds.

### Provider usage

When the daemon reports usage (`usageSources` or `providerUsageList` in `server_info.features`), the status bar ends with a compact meter per provider, such as `claude 62% · resets 3h`: the provider's summary window, or else its most-used window. It refreshes every minute, and the daemon caches reports for five minutes. Providers that report no quota are left out. **Provider usage** in the Command Center lists every window, balance and reset time, plus unavailable or failed reports. **Refresh now** bypasses the daemon cache.

### Context window

When the focused agent reports token usage, the status bar shows `ctx 42% 84k/200k`, turning to warning color from 70% and error color above 90%. **Context window** in the Command Center shows the same numbers plus the session cost.

### Schedules

**Schedules…** lists the daemon's schedules with name, cadence, target, next run and paused state. Pick one to **Inspect** it, view **Recent runs** (selecting a run opens its agent), **Pause…** / **Resume…**, **Run now…** or **Delete…**. Each action that changes a schedule waits for `y` before it runs, and its result appears in the status bar.

**New schedule…** asks for a cadence (`5m`, `2h`, `1d`, or a five-field cron such as `0 9 * * 1-5`), then a target: the focused agent, another existing agent, or a new agent in a workspace (provider, model, mode and title, as in **New agent…**). It then asks for the prompt sent on each run and an optional name, and shows a summary to confirm. Intervals are sent as cron expressions, so an interval must divide evenly into an hour or a day (`7m` is rejected). Schedule requests are baseline daemon RPCs, so no feature flag gates them.

### Terminal activity

Terminal tabs show the same dots as agent tabs when the daemon reports terminal activity: a spinner while the terminal's agent works, `!` while it waits for input, and `●` after it finishes, until you open the tab. The daemon reports activity only for terminal agents with Paseo hooks installed ("Enable terminal agent hooks" in the app's host settings); other terminals show no dot. Activity arrives with the terminal list, which refreshes on workspace changes and every three seconds.

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

- Read [AGENTS.md](AGENTS.md); it holds the project rules (layering, strict TypeScript, testing style). They apply to human and AI-assisted changes alike.
- Write a failing behavioral test first, colocated as `*.test.ts` / `*.test.tsx`.
- Make sure `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass; CI runs the same checks. Run `npm run test:integration` when you touch the connection layer.

## License

[Apache License 2.0](LICENSE). `src/connection/local-credential.ts` is copied from [Paseo](https://github.com/getpaseo/paseo) under the same license; see [NOTICE](NOTICE).
