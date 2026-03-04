# Web View — UI Specification

> Parent: [Frontend Module](../README.md) | Status: **Active** | Created: 2026-02-27

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Layout](#layout)
4. [Header Bar](#1-header-bar)
5. [Left Panel — Navigation & Progress](#2-left-panel--navigation--progress)
6. [Center Panel — Claude Sessions](#3-center-panel--claude-sessions-chat-ui)
7. [Right Panel — Context Panel](#4-right-panel--context-panel)
8. [Status Bar](#5-status-bar)
9. [Command Palette](#6-command-palette)
10. [Keyboard Shortcuts](#7-keyboard-shortcuts)
11. [Context Linking](#8-context-linking)
12. [Known Limitations](#known-limitations)
13. [Related Specs](#related-specs)

## Overview

The Bonsai web view is a three-panel workspace for specification-driven development with AI agents. The center panel hosts Claude agent sessions (custom Chat UI) and file views, while the right panel is a context-aware sidebar that auto-switches between spec context, agent context, code context, and a project dashboard based on what's active in the center. The left panel combines navigation (spec tree, requirements, files) with a spec-driven progress tracker.

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
│  PANEL         │  Sessions + Files        │  Context Panel (auto)    │
│                │                          │                          │
│  [Specs]       │  ┌─ tab1 ─┬─ tab2 ─┬─+  │  ┌────────────────────┐ │
│  [Reqs]        │  │                      ││  │ ▼ Connected Specs  │ │
│  [Files]       │  │  Chat UI:            ││  │ ▼ Tasks (3)        │ │
│  [Progress]    │  │  • Claude text        ││  │ ▼ Covered Files    │ │
│                │  │  • tool calls         ││  │ ▶ Spec Health      │ │
│  tree / list / │  │  • questions          ││  │                    │ │
│  dashboard     │  │  • approvals          ││  │ (auto-switches by  │ │
│                │  │                      ││  │  center content)   │ │
│                │  │  [Message...]  [Send] ││  └────────────────────┘ │
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

## 4. Right Panel — Context Panel

Toggle visibility: `Cmd+J`

> **Full specification:** [CONTEXT_PANEL.md](CONTEXT_PANEL.md)

The right panel is a **context-aware sidebar** that auto-switches content based on what's active in the center panel. It has **no tabs** — instead, it renders stacked collapsible sections relevant to the current context.

### Context Modes

| Center panel shows | Right panel mode | Key sections |
|---|---|---|
| Spec file open | **Spec Context** | Connected specs subgraph, linked tasks, covered files, spec health |
| Active agent session | **Agent Context** | Task spec preview, files modified (live), related specs, compliance hints |
| Code file open | **Code Context** | Covering specs, related tasks, staleness indicator |
| Nothing selected | **Project Dashboard** | Spec coverage, open tasks, recent activity |

Mode is derived from existing stores (`sessionStore`, `fileStore`, `specStore`) — no new state required. Priority: active session > spec file > code file > selected spec > dashboard.

### Peek-to-Center

Sections with rich content (graphs, full spec text) show a compact preview with a `[⇱]` button that opens the full view in the center panel. This solves the 380px width constraint while keeping context accessible.

### Previous Components (relocated)

The following views from the old tab-based right panel are now handled differently:

| Old tab | New location |
|---------|-------------|
| **Graph** | Compact "Connected Specs" subgraph in Spec Context mode. Full graph via `[⇱]` opens in center. See [GRAPH_INTERACTIONS.md](GRAPH_INTERACTIONS.md). |
| **Spec** | Spec files now open directly in the center panel FileViewer |
| **Code** | Code files open in the center panel FileViewer |
| **Diff** | Available via DiffViewer in center panel. See [DIFF_VIEWER.md](DIFF_VIEWER.md). |
| **Console** | Removed from UI for now. Not core to spec-driven workflow. |

### File Viewer / Code Editor

Files open as tabs in the **center panel** tab bar alongside session tabs. Double-clicking a file in the left panel's File Tree opens it.

**Implementation:** Monaco Editor (`@monaco-editor/react`) with custom IntelliJ Darcula theme.

**Opening files:**
- Double-click any file in FileTree → opens as tab in center panel
- `.md` files open as rendered markdown preview; other files open in Monaco Editor

**Preview mode** (default):
- **Code files:** Read-only Monaco editor with syntax highlighting, line numbers, minimap, Cmd+F search
- **Markdown files:** Rendered HTML preview using `react-markdown` + `remark-gfm` + `mermaid`. GFM (tables, task lists, strikethrough) and Mermaid diagrams (` ```mermaid ` code blocks rendered as SVG with dark theme). Styled with JetBrains-inspired typography. Zoom controls: global +/−/reset (top-right, scales font-size) and per-diagram +/−/reset (hover to reveal, scales diagram SVG).
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
| `Cmd+G` | Open full graph view in center panel |
| `Cmd+P` | Open spec view in center panel |

## 8. Context Linking

The right panel (Context Panel) **automatically derives its mode and content** from the center panel state. There are no manual tabs to switch — the panel always shows the most relevant context.

**Mode derivation priority:** active session > spec file > code file > selected spec > dashboard.

**Linking behavior:**
1. When a session starts → right panel switches to **Agent Context** (task spec, files modified, related specs, compliance)
2. When user opens a spec file in center → right panel switches to **Spec Context** (connected specs, tasks, covered files, health)
3. When user opens a code file in center → right panel switches to **Code Context** (covering specs, related tasks, staleness)
4. When nothing is active → right panel shows **Project Dashboard** (coverage, open tasks, activity feed)
5. Clicking items in the right panel (specs, tasks, files) opens them in the center panel, which may trigger a mode switch

See [CONTEXT_PANEL.md](CONTEXT_PANEL.md) for full specification.

## 9. Future Sub-Specifications

The following areas require their own detailed specs as the design matures:

| Component | Scope | Notes |
| --- | --- | --- |
| **Chat UI Rendering** | Detailed rendering rules for each agent event type, streaming behavior, markdown rendering, syntax highlighting | How tool cards expand/collapse, animation timings, error states |
| **Graph Interactions** | Layout algorithm, edge routing, node positioning, zoom/pan behavior, animation, force-directed vs hierarchical layout | Library choice (D3, React Flow, Cytoscape) |
| **Diff Viewer** | Spec-to-code correlation logic, commit navigation, inline vs side-by-side, change grouping | How to match spec sections to code files |
| **Progress Tracker** | Data sources for each metric, update frequency, budget configuration, alert thresholds | Backend API additions needed for cost/token tracking |
| **New Session Modal** | Skill registry integration, spec selector UI, session configuration options | Validation rules, default values |
| ~~**Console**~~ | ~~Terminal emulator~~ | Removed from UI for now — not core to spec-driven workflow |
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
- **Sub-specs:** [Chat UI](CHAT_UI.md), [Graph](GRAPH_INTERACTIONS.md), [Context Panel](CONTEXT_PANEL.md), [Modal](NEW_SESSION_MODAL.md), [Palette](COMMAND_PALETTE.md), [Notifications](NOTIFICATION_SYSTEM.md), [Diff](DIFF_VIEWER.md), [Progress](PROGRESS_TRACKER.md), [History](SESSION_HISTORY.md), [App Shell](APP_SHELL.md), [Theming](THEMING.md), [Responsive](RESPONSIVE_BEHAVIOR.md)