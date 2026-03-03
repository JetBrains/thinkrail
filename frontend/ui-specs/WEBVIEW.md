# Web View — UI Specification

> Parent: [Frontend Module](../README.md) | Status: **Active** | Created: 2026-02-27

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Layout](#layout)
4. [Header Bar](#1-header-bar)
5. [Left Panel — Navigation & Progress](#2-left-panel--navigation--progress)
6. [Center Panel — Claude Sessions](#3-center-panel--claude-sessions-chat-ui)
7. [Right Panel — Contextual Views](#4-right-panel--contextual-views)
8. [Status Bar](#5-status-bar)
9. [Command Palette](#6-command-palette)
10. [Keyboard Shortcuts](#7-keyboard-shortcuts)
11. [Context Linking](#8-context-linking)
12. [Known Limitations](#known-limitations)
13. [Related Specs](#related-specs)

## Overview

The Bonsai web view is a three-panel workspace for specification-driven development with AI agents. The center panel hosts Claude agent sessions (custom Chat UI), while the right panel provides contextual views (graph, spec, code, diff, console) that auto-link to the active session. The left panel combines navigation (spec tree, requirements, files) with a spec-driven progress tracker.

## Architecture

```
┌─────────────────────────────────────────────┐
│  VIEW LAYER  (browser)                      │
│     HTML/CSS/JS  ←→  WebSocket client       │
└──────────────────┬──────────────────────────┘
                   │
                   │ WebSocket (JSON-RPC 2.0)
                   │
┌──────────────────▼───────┐
│  SERVER LAYER  (Backend) │
└──────────────────────────┘
```

The frontend renders agent events streamed from the backend via JSON-RPC notifications (`agent/textDelta`, `agent/toolCallStart`, `agent/askUserQuestion`, etc.) into a rich, custom Chat UI.

## Layout

```
┌────────────────┬──────────────────────────┬──────────────────────────┐
│  LEFT          │  CENTER                  │  RIGHT                   │
│  PANEL         │  Claude Sessions         │  Graph|Spec|Code|Diff|Con│
│                │                          │                          │
│  [Specs]       │  ┌─ tab1 ─┬─ tab2 ─┬─+  │  ┌────────────────────┐ │
│  [Reqs]        │  │                      ││  │ context-linked     │ │
│  [Files]       │  │  Chat UI:            ││  │ view               │ │
│  [Progress]    │  │  • Claude text        ││  │                    │ │
│                │  │  • tool calls         ││  │ auto-follows       │ │
│  tree / list / │  │  • questions          ││  │ active session     │ │
│  dashboard     │  │  • approvals          ││  │                    │ │
│                │  │                      ││  └────────────────────┘ │
│                │  │  [Message...]  [Send] ││                          │
│                │  └──────────────────────┘│                          │
├────────────────┴──────────────────────────┴──────────────────────────┤
│  STATUS BAR: specs count · done · pending · active sessions · keys  │
└─────────────────────────────────────────────────────────────────────┘
```

All three panels have **flexible width**, resizable via drag handles between them. Each panel has a min/max width constraint to prevent unusable sizes:

| Panel | Default | Min | Max |
| --- | --- | --- | --- |
| Left | 260px | 140px | 420px |
| Center | flex (fills remaining) | 300px | — |
| Right | 380px | 200px | 600px |

## 1. Header Bar

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🌿 Bonsai │ Project: <name> │ ● N sessions │    [◀ Tree] [+ New]  │
└─────────────────────────────────────────────────────────────────────┘
```

| Element | Description |
| --- | --- |
| Logo | "🌿 Bonsai" branding |
| Project name | Current project root name |
| Session indicator | Count of active agent sessions, pulsing dot |
| `◀ Tree` button | Toggle left panel visibility (`Ctrl+B`) |
| `+ New Session` button | Opens new session modal (`Cmd+T`) |

## 2. Left Panel — Navigation & Progress

Toggle visibility: `Ctrl+B`

### Tabs

| Tab | Description |
| --- | --- |
| **Specs** | Hierarchical tree of specifications grouped by type (goal → architecture → module → submodule → task). Each node shows icon, title, and status badge (✓ done, ● active, ○ pending, ! waiting, ~ stale). |
| **Requirements** | List of project requirements as cards. Each card shows: ID, text, priority badge (critical/high/medium), and implementation coverage state. |
| **Files** | Standard folder tree of the project repository. |
| **Progress** | Spec-driven progress dashboard — the primary way to track project state and session activity. See §2.1. |

### Behavior

- Clicking a spec node selects it → right panel views update to show that spec's context
- Clicking a spec node also highlights it in the Graph view
- Double-clicking a spec opens it in the Spec view tab on the right panel
- Tree nodes are expandable/collapsible

### 2.1 Progress Tab — Spec-Driven Progress Tracker

The Progress tab is the unified project health and session activity dashboard. It combines spec-driven metrics, live session tracking, and file change monitoring into a single view.

#### Spec-Driven Progress

The top section shows overall project state from the specification perspective:

```
┌─────────────────────────────────────┐
│  SPEC PROGRESS              67%    │
│  ████████████░░░░░░░         8/12  │
│                                     │
│  ✓ 2 done  ● 4 active  ○ 5 pending│
│  ~ 0 stale                         │
│                                     │
│  REQUIREMENTS               50%    │
│  ██████████░░░░░░░░░░        2/4   │
│                                     │
│  COVERAGE                   67%    │
│  8 of 12 source paths covered      │
└─────────────────────────────────────┘
```

| Metric | Description |
| --- | --- |
| Spec progress | Percentage of specs in "done" status vs total. Progress bar. |
| Spec status breakdown | Count by status: done / active / pending / stale |
| Requirements progress | Requirements with coverage vs total. Progress bar. |
| Source coverage | Percentage of source paths covered by at least one spec |

#### Active Session Tracker

Shows the state of all running agent sessions:

```
┌─────────────────────────────────────┐
│  ACTIVE SESSIONS                    │
│                                     │
│  ● module-design         ▸ running  │
│    Step: Writing models.py          │
│    3 files · $0.08 · 2m 14s        │
│    ▸ models.py ▸ service.py (new)   │
│                                     │
│  ✓ architecture          ▸ done     │
│    $0.12 · 8 turns · 45s           │
└─────────────────────────────────────┘
```

For each session:

| Field | Description |
| --- | --- |
| Name + status | Session name with running/done/error indicator |
| Current step | What the agent is doing right now (derived from latest `agent/toolCallStart` or `agent/textDelta`) |
| Metrics | Files touched, cost so far, elapsed time |
| File changes | List of files created/modified by this session (clickable → opens diff) |

#### Activity Timeline

A compact vertical timeline of recent agent actions across all sessions:

```
┌─────────────────────────────────────┐
│  ACTIVITY                           │
│                                     │
│  14:23  ✏️  Write models.py         │
│  14:22  📖  Read README.md          │
│  14:22  🔍  Grep "BaseModel"        │
│  14:21  ⚡  Subagent: Explore       │
│  14:21  📖  Read spec/README.md     │
│  14:20  🚀  Session started         │
└─────────────────────────────────────┘
```

- Each entry: timestamp + icon + brief description
- Clickable → scrolls chat to that event
- Color-coded by action type
- Auto-scrolls as new events arrive

#### Live File Changes

Files modified across all active sessions:

```
┌─────────────────────────────────────┐
│  FILES CHANGED              3 files │
│                                     │
│  + backend/app/spec/models.py       │
│  + backend/app/spec/service.py      │
│  ~ backend/app/spec/README.md       │
└─────────────────────────────────────┘
```

- `+` = created, `~` = modified, `-` = deleted
- Clicking a file → opens Diff view in the right panel for that file
- Badge count shown on the Progress tab label

#### Cost & Token Budget

```
┌─────────────────────────────────────┐
│  SESSION COST                       │
│  $0.20 total  ·  18.4k tokens      │
│                                     │
│  Budget: $5.00           4% used    │
│  ██░░░░░░░░░░░░░░░░░░░░            │
└─────────────────────────────────────┘
```

- Running total cost and token count across all sessions
- Optional budget limit (configurable)
- Warning indicator when approaching budget (>80%)

## 3. Center Panel — Claude Sessions (Chat UI)

The primary workspace. Hosts one or more tabbed Claude agent sessions rendered as a custom Chat UI.

### Session Tabs

```
┌─ module-spec ─┬─ refactor-agent ─┬─ + ─┐
```

- Each tab represents an agent session (started via `agent/run`)
- Tab shows: session name + status dot (running/done/error)
- **Background alert badge**: when a non-active session needs attention (question pending, error, or completed), its tab shows a notification badge (colored dot or count)
- `+` button or `Cmd+T` opens the new session modal
- `Cmd+1-9` switches between session tabs
- Tabs can be closed (with confirmation if session is running)

### Background Session Alerts

When the user is viewing session A and session B needs attention:

1. **Tab badge** — session B's tab shows a pulsing indicator:
   - 🟣 purple dot = question pending (`agent/askUserQuestion`)
   - 🟡 gold dot = approval pending (`agent/confirmAction`)
   - 🟢 green dot = session completed (`agent/done`)
   - 🔴 red dot = error (`agent/error`)
2. **Toast notification** — a slide-in toast appears at the bottom-right:
   - Shows session name, event type, and brief message
   - Clickable → switches to that session
   - Auto-dismisses after 5 seconds (except for pending user input — those persist)
3. **Status bar indicator** — status bar shows "⚠ N sessions need attention" when any session has pending input
4. **Sound** — optional audio ping for pending user input (configurable, off by default)

### Session History

Completed and closed sessions are preserved in a session archive:

- Accessible via the Progress tab → "Session History" section (below active sessions)
- Each archived session shows: name, skill, start/end time, result (done/error), cost, turns
- Clicking an archived session opens it in read-only mode in the center panel (chat log viewable, input disabled)
- Sessions persist for the lifetime of the server process (not persisted to disk in v1)

### Chat UI — Message Types

The Chat UI renders agent events from the JSON-RPC stream into rich visual elements:

| Agent Event | UI Rendering |
| --- | --- |
| `agent/textDelta` | Claude's text, streamed character-by-character. Rendered as markdown with syntax highlighting. |
| `agent/toolCallStart` | Collapsible tool call card: shows tool name, input params. Animated "running" indicator. |
| `agent/toolCallEnd` | Tool call card updates: shows output/result, success/error status. |
| `agent/subagentStart` | Nested indented section: "⚡ Subagent: {type}" with spinner. |
| `agent/subagentEnd` | Subagent section collapses, shows summary. |
| `agent/askUserQuestion` | Interactive question card: renders question text, option buttons (single/multi select). User clicks to respond → sends `agent/respond`. |
| `agent/confirmAction` | Approval card: shows tool name, input, description. "Approve" / "Deny" buttons → sends `agent/respond`. |
| `agent/done` | Completion banner: shows result summary, cost, duration, token usage. |
| `agent/error` | Error banner: red, shows error details. |
| `agent/notification` | System notification: subtle, centered text. |
| `agent/compact` | Compact boundary marker: "Context compacted — {preTokens} tokens". |

### Session Status Line

A compact status strip displayed between the chat area and the input area, showing live session metrics:

```
┌──────────────────────────────────────────────────────────────────────┐
│ claude-opus-4-6 │ $0.08 │ ██████░░ 12 calls │ ctx 45k/200k ██░░░░ │
└──────────────────────────────────────────────────────────────────────┘
```

| Element | Description |
| --- | --- |
| Model | Model identifier used by the session (e.g., `claude-opus-4-6`) |
| Cost | Running USD cost for this session (updated on each turn) |
| Progress bar | Visual indicator of task activity — fills based on tool calls completed vs estimated. Animated while session is running. |
| Tool calls | Count of tool calls made in this session |
| Context bar | Visual bar showing context window usage: `{used}k / {max}k` with fill. Changes color as it fills: green (<50%), gold (50-80%), red (>80%) |

The status line updates in real-time as agent events stream in. Data sources:
- Model and cost: from `agent/sessionStart` and `agent/done`
- Tool calls: incremented on each `agent/toolCallEnd`
- Context size: from `agent/compact` (`preTokens`) and SDK configuration

### Input Area

```
┌─────────────────────────────────────────┐
│ [Message Claude...]              [Send] │
│ Cmd+Enter send · Cmd+T new · Cmd+1-9   │
└─────────────────────────────────────────┘
```

- Auto-resizing textarea
- `Cmd+Enter` to send
- When a session is waiting for user input (`agent/askUserQuestion`), the input area is supplemented by the interactive question card above it

### New Session Modal

Triggered by `+ New Session` or `Cmd+T`:

| Field | Description |
| --- | --- |
| Session name | Free text (e.g., "Module: session-manager") |
| Skill | Grid of available skills (goal-and-requirements, architecture-design, module-design, etc.) |
| Target spec(s) | Optional — select specs to pass as context to the agent |

Clicking "Start Session" → calls `agent/run` with selected config.

## 4. Right Panel — Contextual Views

Toggle visibility: `Cmd+J`

The right panel provides views that **auto-link to the active session's context**. When a session is working on a spec, the right panel shows that spec's graph position, content, related code, etc.

### Tabs

#### 4.1 Graph

Interactive spec hierarchy visualization with **layered drill-down navigation**.

##### Visual Elements

- **Nodes** = specs (colored by type: goal, architecture, module, submodule, task)
- **Edges** = visible connections between nodes from `registry.json` (parent/child, depends-on, references, implements). Rendered as SVG lines/curves with arrowheads. Edge style indicates relationship type (solid = parent/child, dashed = depends-on, dotted = references).
- **Active node** = highlighted based on current session's spec context
- **Health overlay** = node border/color reflects status (done=green, active=blue, stale=red, pending=gray)
- **Zoom/pan** controls
- **Legend** showing node types, status colors, and edge types

##### Layered Navigation

The graph displays one layer at a time rather than the full hierarchy. Users drill down into nodes to explore children.

**Behavior:**

1. **Default view** — shows the top-level layer: Goal node(s) and their direct children (Architecture specs), with edges connecting them
2. **Click a node** → drills into that node: the view transitions to show the clicked node as the "root" with its direct children and their interconnections
3. **Breadcrumb trail** — displayed at the top of the graph area, showing the ancestor path:
   ```
   ┌──────────────────────────────────────────────┐
   │  ← │ Goal & Requirements > Architecture > ●  │
   │─────────────────────────────────────────────-─│
   │                                               │
   │       ┌──────┐   ┌──────┐                    │
   │       │ Spec │──→│ Core │                    │
   │       │Module│   │Module│                    │
   │       └──┬───┘   └──────┘                    │
   │          │                                    │
   │       ┌──┴───┐   ┌──────┐                    │
   │       │Agent │──→│ RPC  │                    │
   │       │Module│   │Module│                    │
   │       └──────┘   └──────┘                    │
   └──────────────────────────────────────────────┘
   ```
4. **Breadcrumb click** — clicking any ancestor in the breadcrumb navigates back up to that layer
5. **Back button** (`←`) — goes up one level to the parent layer
6. **Leaf nodes** — clicking a node with no children selects it (updates Spec/Code/Diff views) but does not drill down

**Node context menu** (right-click):

| Action | Description |
| --- | --- |
| New session for this spec | Creates a new center-panel session pre-loaded with this spec as context |
| Ask about this spec | Opens a new session with a question prompt about this spec |
| Implement / Specify | If spec exists → new session to implement. If unspecified → new session to create the spec |
| Edit spec | New session with the relevant skill loaded to update this spec |

**Single click** → drills into node (if it has children) or selects it (if leaf).
**Double click** → selects the spec and updates Spec/Code/Diff views without drilling down.

#### 4.2 Spec

Rendered markdown view of the selected specification.

- Nice, readable formatting (headers, tables, code blocks, mermaid diagrams)
- Breadcrumb showing spec hierarchy path
- **Edit mode toggle**: small "Edit" button in the top-right corner switches to a markdown editor for quick manual edits (typo fixes, small tweaks). Saving writes directly to the spec file on disk.
- **Agent nudge**: when exiting edit mode after changes, a subtle prompt appears: "Want Claude to review these changes?" — clicking it opens a new session pre-loaded with the edited spec and a review prompt. This preserves the spec-driven workflow while allowing quick manual fixes.

#### 4.3 File Viewer / Code Editor

Files open as tabs in the **center panel** tab bar alongside session tabs. Double-clicking a file in the left panel's File Tree opens it.

**Implementation:** Monaco Editor (`@monaco-editor/react`) with custom IntelliJ Darcula theme.

**Opening files:**
- Double-click any file in FileTree → opens as tab in center panel
- `.md` files open as rendered markdown preview; other files open in Monaco Editor

**Preview mode** (default):
- **Code files:** Read-only Monaco editor with syntax highlighting, line numbers, minimap, Cmd+F search
- **Markdown files:** Rendered HTML preview using `react-markdown` + `remark-gfm` (GitHub-Flavored Markdown: tables, task lists, strikethrough). Styled with JetBrains-inspired typography.
- Toolbar: file path + language badge + line count + file size + Copy button
- "Edit" button in toolbar → opens dropdown

**Edit dropdown:**
- "Edit in place" → switches to edit mode
- "Open in IntelliJ IDEA" → calls backend `POST /api/file/open-external` with `editor: "idea"`
- "Open in VS Code" → same with `editor: "code"`
- "Open in Vim" → same with `editor: "vim"` (opens in a terminal emulator window with user's `.vimrc` settings). Also supports `nvim`, `nano`, `vi`.

**Edit mode:**
- Same Monaco editor, `readOnly: false`
- Tab shows dirty indicator (gold dot) when content differs from saved
- "Save" button → `POST /api/file/write` → clears dirty state
- "Cancel" button → reverts to original content, switches back to preview

**File tabs:**
- Rendered in SessionTabBar after session tabs, separated by a vertical divider
- Each tab: file icon + filename + dirty dot (if modified) + close button
- Only one tab active at a time (session OR file)

**Supported languages:** Python, TypeScript/TSX, JavaScript/JSX, CSS, HTML, JSON, Markdown, YAML, Shell, SQL, Rust, Go, Java, Kotlin, Ruby, XML

**Theme:** IntelliJ Darcula colors — keywords (#CF8E6D orange), strings (#6AAB73 green), comments (#7A7E85 gray italic), functions (#56A8F5 blue), types (#C77DBB purple), numbers (#2AACB8 teal)

#### 4.4 Diff

**Spec + Code side-by-side diff**, change-by-change.

```
┌──────────────────────┬──────────────────────┐
│  SPEC DIFF           │  CODE DIFF           │
│                      │                      │
│  - old spec text     │  - old code line     │
│  + new spec text     │  + new code line     │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

- Shows how spec changes correspond to code changes
- Commit-by-commit navigation (prev/next change)
- Highlights additions (green) and deletions (red)

#### 4.5 Console

Standard terminal emulator in the right panel.

- For running manual commands, viewing logs, etc.
- Independent of the center panel sessions

## 5. Status Bar

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🌿 N specs │ ● N done │ ⏳ N pending │        Cmd+T New · Ctrl+B Tree  │
└──────────────────────────────────────────────────────────────────────────┘
```

Always visible at the bottom. Shows:
- Spec counts (total, done, pending)
- **"N sessions"** — clickable link that opens the Session Manager in the center panel
- Attention indicator when sessions need user input
- Keyboard shortcut hints

### Session Manager

Clicking "N sessions" in the status bar replaces the center panel content with the **Session Manager** — a list of all sessions (active + archived from `.specs/sessions/`).

**Grouped by status:** Active (idle/running) → Completed (done) → Errors

**Per session card:** name, status badge, model, created time, cost/turns

**Actions:**
- **Active sessions:** "Switch to" → returns to that session tab
- **Completed/Error sessions:** "Continue" → creates new SDK session with old conversation replayed as context (via `session/continue` RPC), "Delete" → removes from disk
- **"Back to sessions"** button → returns to normal tab view

## 6. Command Palette

Triggered by `Cmd+K`. A floating search modal for quick navigation and actions:

```
┌──────────────────────────────────────────────┐
│  🔍 Search specs, files, sessions, actions...│
│──────────────────────────────────────────────│
│  📦 Spec Module                        spec  │
│  📦 Core Module                        spec  │
│  🏛 Architecture Design                spec  │
│  ● module-design                    session  │
│  ✨ New session                      action  │
│  📄 backend/app/spec/models.py         file  │
└──────────────────────────────────────────────┘
```

| Category | What it searches | Action on select |
| --- | --- | --- |
| **Specs** | All specs by title, type, tags | Selects spec → updates right panel |
| **Sessions** | Active and archived sessions by name, skill | Switches to that session tab |
| **Files** | Project files by path | Opens file in Code view |
| **Actions** | Built-in actions: New session, Toggle panel, etc. | Executes the action |

- Fuzzy matching on input text
- Results grouped by category with type badge
- Arrow keys to navigate, Enter to select, Esc to dismiss
- Recent items shown when palette opens with empty query

## 7. Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+K` | Open command palette |
| `Ctrl+B` | Toggle left panel |
| `Cmd+J` | Toggle right panel |
| `Cmd+T` | New session |
| `Cmd+1-9` | Switch session tabs |
| `Cmd+Enter` | Send message |
| `Cmd+G` | Focus graph view |
| `Cmd+P` | Focus spec view |

## 8. Context Linking

The right panel auto-follows the active session's context:

1. When a session starts with spec context → right panel selects that spec
2. When agent references a spec (`agent/toolCallStart` on a spec file) → graph highlights it
3. When user clicks a spec in the left tree → right panel updates, center panel is unaffected
4. When user clicks a graph node → right panel updates to that spec
5. Manual override: user can click any tab/spec in right panel independently; auto-link resumes on next session event

## 9. Future Sub-Specifications

The following areas require their own detailed specs as the design matures:

| Component | Scope | Notes |
| --- | --- | --- |
| **Chat UI Rendering** | Detailed rendering rules for each agent event type, streaming behavior, markdown rendering, syntax highlighting | How tool cards expand/collapse, animation timings, error states |
| **Graph Interactions** | Layout algorithm, edge routing, node positioning, zoom/pan behavior, animation, force-directed vs hierarchical layout | Library choice (D3, React Flow, Cytoscape) |
| **Diff Viewer** | Spec-to-code correlation logic, commit navigation, inline vs side-by-side, change grouping | How to match spec sections to code files |
| **Progress Tracker** | Data sources for each metric, update frequency, budget configuration, alert thresholds | Backend API additions needed for cost/token tracking |
| **New Session Modal** | Skill registry integration, spec selector UI, session configuration options | Validation rules, default values |
| **Console** | Terminal emulator choice (xterm.js), shell integration, session persistence | Interaction with agent sessions |
| **Command Palette** | Fuzzy search algorithm, indexing strategy, action registry, keyboard navigation | Performance with large projects |
| **Session History & Persistence** | Storage format, retention policy, read-only replay mode, future disk persistence | Backend API additions for session archival |
| **Notification System** | Toast queue management, priority ordering, sound configuration, persistence rules | Interaction with OS-level notifications |
| **Theming** | Color scheme, dark/light mode, customization | CSS variable system, user preferences |
| **Responsive Behavior** | Panel collapse rules at narrow widths, mobile considerations | Breakpoints, touch interactions |

## 10. Backend API Gaps

The following RPC methods and endpoints are referenced by frontend sub-specs but **not yet designed in the backend RPC module spec** (`backend/app/rpc/README.md`). These must be added before the corresponding frontend features can be implemented.

| Methods | Referenced By | Description |
| --- | --- | --- |
| `cost/summary`, `cost/setBudget`, `cost/reset` | [Progress Tracker](PROGRESS_TRACKER.md) §6 | Cost tracking and budget management. Requires `.specs/cost.json` persistence. |
| `diff/mappings`, `diff/commit`, `diff/scan` | [Diff Viewer](DIFF_VIEWER.md) §3 | Spec-to-code mapping extraction from git history. Requires mapping file I/O. |
| `/terminal/create`, `/terminal/{id}/ws`, `/terminal/{id}/resize`, `/terminal/{id}/kill` | [Console](../src/components/Console/README.md) §Backend Integration | Terminal process management via PTY. Separate WebSocket per terminal (not JSON-RPC). Requires new FastAPI router. |
| `cost/didUpdate` (notification) | [Progress Tracker](PROGRESS_TRACKER.md) §6.4 | Server→client notification when cost data changes. |

## Known Limitations

- **No offline mode:** Requires live WebSocket connection to backend for all functionality
- **Single user:** No multi-user collaboration or concurrent editing
- **Browser only:** No desktop app wrapper (Electron, Tauri) — runs in browser tab
- **English only:** No internationalization support in v1

## Related Specs

- **Parent:** [Frontend Module](../README.md)
- **Depends on:** [Goal & Requirements](../../GOAL&REQUIREMENTS.md)
- **Sub-specs:** [Chat UI](CHAT_UI.md), [Graph](GRAPH_INTERACTIONS.md), [Modal](NEW_SESSION_MODAL.md), [Palette](COMMAND_PALETTE.md), [Notifications](NOTIFICATION_SYSTEM.md), [Diff](DIFF_VIEWER.md), [Progress](PROGRESS_TRACKER.md), [History](SESSION_HISTORY.md), [App Shell](APP_SHELL.md), [Theming](THEMING.md), [Responsive](RESPONSIVE_BEHAVIOR.md)