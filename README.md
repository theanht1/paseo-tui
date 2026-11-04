# paseo-tui

A full-screen terminal client for Paseo, built with TypeScript, OpenTUI, and React on Node 26.4+. It groups agents by workspace and supports live timelines, prompts, permission answers, and stopping turns.

```sh
asdf install nodejs 26.13.0
npm install
npm run dev
npm run dev -- --help
npm run dev -- --version
```

Select a daemon with `npm run dev -- --host <target>` (or use the local daemon by default).

```sh
npm run typecheck
npm run lint
npm test
npm run build
node --experimental-ffi dist/cli.js --version
```

Tests live beside their implementation as `*.test.ts` or `*.test.tsx` and are excluded from the build.

## Keybindings

The UI starts in normal mode. `i` or `a` in a timeline enters insert mode; `Esc` returns to normal. `?` shows the same binding table in the app.

| Context                    | Key                                        | Action                                |
| -------------------------- | ------------------------------------------ | ------------------------------------- |
| Normal                     | `\`                                        | Toggle sidebar                        |
| Normal                     | `q`                                        | Quit                                  |
| Any mode                   | `Ctrl-C`                                   | Quit                                  |
| Normal                     | `?`                                        | Help                                  |
| Normal                     | `Tab`                                      | Switch sidebar/pane                   |
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

Click an agent to select it and click the selected row to open it. Click tool and reasoning headers to expand them; the mouse wheel scrolls the timeline. Use `npm run dev -- --no-mouse` to disable mouse input, or `NO_COLOR=1 npm run dev` for terminal-default colors.

Tool details include shell output (last 200 lines), file content (first 400 lines), and edit diffs. Unknown timeline types remain visible as `[type]`.

## Split panes and search

`Ctrl-B` is the default pane prefix in both normal and insert mode. Use `npm run dev -- --prefix C-a` inside tmux; the flag accepts `C-<letter>` only. Prefix mode expires after 1500 ms, and an unbound key consumes it. Repeat the prefix in insert mode to insert its literal control character.

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

Search is a case-insensitive substring match over loaded history, including collapsed tool output and reasoning. A jump selects the matching block, expands its detail, and scrolls it into view. The status bar shows `match i/n` or `no match`. The Command Center (`Ctrl-K` / `:`) arrives in S4.

## Command Center

Press `Ctrl-K` in any mode, or `:` in normal mode (also after the prefix),
to search agents, workspaces, pane actions, view actions and keyboard help.
Search accepts multiple tokens and fuzzy subsequences. Use arrows or `Ctrl-N` /
`Ctrl-P` to select, then `Enter` to run; clicking a result also runs it.
`Esc` or a click outside closes the palette. Opening it from insert mode restores
insert mode on close. Agent commands can open in the focused pane or a new split
on the right. The focused agent also has stop (while running) and separate Expand all / Collapse all
commands (`O` still toggles both). Additional command sources can register with the shared registry.
