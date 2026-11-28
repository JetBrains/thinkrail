# ThinkRail UI, layout & keyboard shortcuts

## Workbench & panels

ThinkRail uses a splittable workbench with movable left, right, and bottom tool docks (layout is
kept per window; save/apply presets in **Settings › Layout**):

- **Projects** — repository list, worktree workspaces, Settled shelf, and **Chats** (chats without
  a project).
- **Specs** — read-only tree view of the repository's spec graph (`SPEC.md` files).
- **Files** — workspace file tree with git status indicators; opens files in Monaco, rendered
  Markdown (with heading outline), tables, JSON, notebooks, images, or PDFs.
- **Changes** (tab) & **Review** (panel) — git diffs and anchored review comments collected for the
  agent.
- **TODO List** (`plan`) — the active chat's shared plan, completion summaries, verification lines,
  and review cards.
- **Artifacts** — **Outputs** (agent-published deliverables), **Smart**, **List**, and **Tree**
  views over `.thinkrail/context/`.
- **Terminal** (tab) — embedded host shell tabs in the workspace working directory.
- **Topbar location bar** — active project, workspace, chat selector, **Open in** external editor
  menu, Remote branch status (Publish / Push / Sync), and Pull Request status / actions.
- **Session insights** — chart icon at the bottom of the left rail (`⌃⌥I` / `Ctrl+Alt+I`).

## Command palette & search

- **`⌘K` / `Ctrl+K`** (or double-tap **Shift**) — unified command palette:
  - Finds chats (and messages inside them), workspaces, projects, workspace files, specs, plans,
    Settings sections, and individual settings, with a live preview pane.
  - Runs app and active-tab layout commands (split, move tab, close, open Settings, start setup,
    ask about ThinkRail, review a PR).
  - With nothing typed, shows chats waiting for your input and recent places.
  - Type **`#`** followed by a question to search the spec graph by words (`↵` opens the heading;
    `⌥↵` asks the agent in a new chat).
  - Type a task and press **`⌘↵` / `Ctrl+↵`** to open New Workspace pre-filled with that task.
- **`⌘⇧F` / `Ctrl+Shift+F`** — Find in files across the workspace (match-case, whole-word, code
  preview).
- **`Ctrl+R`** — Search chat history while in a chat tab.

## Core keyboard shortcuts

`Mod` means `⌘` on macOS and `Ctrl` on Windows/Linux. Every global and focused-surface shortcut can
be inspected in the cheatsheet (**`⌘?` / `Ctrl+?`**, or the keyboard icon at the bottom of the left
rail in macOS browsers where `⌘?` opens the browser Help menu) and rebound in **Settings › Keyboard**
(with JSON export/import).

### Navigation & layout

| Action | Default shortcut |
| --- | --- |
| Command palette | `Mod+K` (or double-tap `Shift`) |
| Keyboard shortcuts cheatsheet | `Mod+?` |
| New workspace | `Mod+N` (`Mod+Alt+N` in browser) |
| Cycle recent workspaces (desktop) | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Step between panes (next / previous) | `F6` / `Shift+F6` |
| Focus chat input | `Mod+L` |
| Focus Projects panel | `Mod+0` |
| Focus editor group 1–9 | `Mod+1` – `Mod+9` |
| Focus terminal | `` Ctrl+` `` |
| Toggle left / right / bottom panel | `Mod+B` / `Mod+J` / `Mod+Shift+J` |
| Hide/restore all side & bottom panels | `Mod+Shift+F12` |
| Show Files / Changes | `Mod+Shift+E` / `Mod+Shift+G` |
| Split editor right | `Mod+\` |
| Move tab to previous / next group | `⌃⌘←` / `⌃⌘→` (macOS) · `Ctrl+Alt+←` / `Ctrl+Alt+→` |
| Close tab | `Mod+W` (desktop) / `Mod+Alt+W` (browser) |
| Zoom in / out / reset (desktop) | `Mod+=` / `Mod+-` / `Mod+0` (numpad) |
| Voice dictation | `Mod+Shift+Space` |
| Session insights | `⌃⌥I` (macOS) / `Ctrl+Alt+I` |

### Chat, trees, review & hint mode

- **Chat navigation:** `Mod+↑` steps from the composer into the conversation; arrows or `j`/`k`
  move through messages, tool calls, and thinking blocks; `Space` pages; `g`/`G` jump to start/end;
  `→`/`←` expand/collapse; `C` copies; `O` opens the file a tool touched.
- **Next-step chips:** `Alt+1`–`Alt+9` sends a suggested reply; `Shift+Alt+1`–`Shift+Alt+9` puts it
  into the composer to edit first.
- **Agent questions:** `F6` (or `Shift+Tab` from composer) enters options; `←`/`→` moves between
  question tabs; `D` marks a question for discussion; `I` enters an HTML mockup; `Mod+↵` submits.
- **Sidebar trees:** `S` filters visible rows; `h`/`j`/`k`/`l` move like arrows.
- **Diff review:** Tab onto a diff, move the line cursor with arrows or `j`/`k` (`h`/`l` switch
  sides, `Shift` extends), press `Enter` to leave a review comment.
- **Hint mode:** press `F` outside a text field (or `Mod+;` anywhere) to label every clickable
  control; type the label to click it (`Shift` on the last letter focuses only). `Esc` leaves text
  fields. Toggle hint mode off in **Settings › Extensions & skills**.
- **Settings keyboard control:** arrows navigate sections and settings, `Enter` edits, `Space`
  toggles switches, `Delete` resets to default, `S` or `/` searches all settings.

## Appearance, fonts & language

- **Themes** (**Settings › Appearance**): built-in dark, light, minimal, and high-contrast themes
  (follow system or pick fixed). Create custom themes by saving a `*.theme.json` copy into
  `~/.thinkrail/themes` (live-reloaded on save).
- **Fonts** (**Settings › Text & fonts**): choose bundled Geist & JetBrains Mono, system fonts, or
  font files in `~/.thinkrail/fonts`; adjust code size, ligatures, text weight, and chat/code line
  widths.
- **Languages** (**Settings › Language**): follows system language or picks from English, Japanese,
  Korean, Polish, Russian, Simplified Chinese, Spanish, and Traditional Chinese (Taiwan). Add or
  override translations by placing a flat `<tag>.json` file in `~/.thinkrail/locales` (live on
  save). Agent and tool output is never translated.
