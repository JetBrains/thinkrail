---
id: webview
type: module-design
status: active
title: Web View — UI Specification
parent: frontend-module
covers:
- frontend/
tags:
- frontend
- ui
- webview
---
# Web View — UI Specification

> Parent: [Frontend Module](../README.md) | Status: **Active** | Created: 2026-02-27

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Layout](#layout)
4. [Header Bar](#1-header-bar)
5. [Left Panel — Navigation & Progress](#2-left-panel--navigation--progress)
6. [Center Panel](#3-center-panel)
7. [Right Panel — Context Panel](#4-right-panel--context-panel)
8. [Status Bar](#5-status-bar)
9. [Command Palette](#6-command-palette)
10. [Keyboard Shortcuts](#7-keyboard-shortcuts)
11. [Context Linking](#8-context-linking)
12. [Known Limitations](#known-limitations)
13. [Related Specs](#related-specs)

## Overview

The Bonsai web view is a three-panel workspace for specification-driven development with AI agents. The center panel hosts Claude agent sessions (custom Chat UI) and file views, while the right panel is a context-aware sidebar that auto-switches between spec context, agent context, and code context based on what's active in the center (showing an empty welcome state when nothing is selected). The left panel hosts three tabs — spec tree, file tree, and the session manager.

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
│  [Files]       │  │                      ││  │ ▼ Connected Specs  │ │
│  [Progress]    │  │  Chat UI:            ││  │ ▼ Tasks (3)        │ │
│                │  │  • Claude text        ││  │ ▼ Covered Files    │ │
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
│ 🌿 Bonsai │ Project: <name> │ [Board] [Sessions] │         [⚙]   │
└─────────────────────────────────────────────────────────────────────┘
```

| Element | Description |
| --- | --- |
| Logo | "🌿 Bonsai" branding |
| Project name | Current project root name; click to switch project |
| Board / Sessions tabs | Center view switcher; Sessions tab shows live count of running sessions |
| Settings (`⚙`) | Opens the settings modal |

The "+ New session" button does **not** live in the header — it sits inside the Sessions view's tab bar (see §3). `Mod+T` is the global shortcut and auto-routes to the Sessions view before creating the draft.

## 2. Left Panel — Navigation

Toggle visibility: `Mod+B`

### Tabs

| Tab | Description |
| --- | --- |
| **Specs** | Hierarchical tree of specifications grouped by type (goal → architecture → module → submodule → task). Each node shows icon, title, and status badge (✓ done, ● active, ○ pending, ! waiting, ~ stale). |
| **Files** | Folder tree of the project repository. Visibility is controlled by `.bonsaihide` (gitignore-style config file in project root; `!` prefix for exceptions, last-match-wins). Toolbar has Collapse All, Expand All, and a Show Hidden toggle (👁) that temporarily bypasses `.bonsaihide` rules. Toggle state is persisted per-project in `localStorage`. |
| **Sessions** | Full session list for the current project (`SessionManager`). See §2.1. |

### Behavior

- Clicking a spec node selects it → right panel views update to show that spec's context
- Clicking a spec node also highlights it in the Graph view
- Double-clicking a spec opens it in the Spec view tab on the right panel
- Tree nodes are expandable/collapsible

### 2.1 Sessions Tab

The Sessions tab renders the full `SessionManager` view: a flat list of every session for the current project, sorted by `updatedAt` descending. Each row is a dense IDE-tab style card — the panel scans like a source-control panel rather than a series of badged tiles.

Card layout (CSS grid, three rows):

```
[dot] [name ............................] [time]
[ticket chip ─ stripe · title · #id           ]   (omitted when no ticket)
[↻ 3]  [$0.18] .................. [🗑 hover]
```

- **Status as a 7px dot** at the start of the header row. Colors come from the status palette (`--muted` draft, `--blue` idle/initializing, `--primary` running with a pulse, `--gold` waiting/interrupted, `--green` done, `--red` error). Reading the status word is never necessary.
- **Name** is the dominant text. Generic auto-names (`/^Session \d+$/`) render in monospace + muted to make custom names visibly dominate. Draft sessions render the name in italic + muted with the literal time slot showing "draft".
- **Time** is a relative "4h" / "6d" / "now" stamp in tabular numerals. Running sessions show "now" in purple.
- **Ticket chip** (only when attached): a single chip containing a 4px colored stripe + ticket title + short id (`#xxxx`). The stripe color is deterministically derived from `metaTicketId`, so sessions on the same ticket share the same chip color and cluster pre-attentively as the user scans. When no ticket is attached, the row collapses entirely — card is two lines.
- **Metrics chips**: `↻ {turns}` and `$ {costUsd}` chips on the bottom row. Hidden when both are zero (draft / fresh session) but the row keeps its height so the grid doesn't jump on first turn.
- **Delete** is the only explicit action — a small trash icon button on the bottom-right, **hover-revealed**. Clicking anywhere else on the card opens / switches to / restores the session (`onOpen`).
- **Needs attention** state (status = `waiting`, or `pendingRequest` truthy) lights a 2px `--gold` glow on the left edge of the card.

The panel re-fetches automatically: `session/didCreate` triggers a full `session/list` refresh (the wire payload is minimal); `session/didEnd` and `agent/statusChanged` patch the affected row in place via `sessionStore.patchSessionInList`. An `↻` button in the top-right forces an explicit refresh.

**Removed deliberately:**
- Status group labels (Active / Pending / etc.) — most projects share one status across most cards, so groups were weak signal. The badge → dot move makes status visible without taking layout real estate.
- Model label — already visible (and editable) in the chat's bottom toolbar; duplicating it per card was noise.
- Open / Switch-to / Continue / Stop buttons — the card itself is the open/switch/restore affordance, and every in-session control is one click away after that. Only Delete has no in-session equivalent, so it stays.

The tab is coupled to a set of explicit "show me the Sessions UI" affordances. Other flows that incidentally flip the center view to Sessions deliberately do not steal sidebar focus:

- **Header `Sessions` tab** and **footer "n sessions" button** focus this tab (and the footer button also uncollapses the left panel if it was hidden).
- **Clicking a session card** auto-switches the center view to Sessions and opens (or activates) that session's tab — so cards work as a navigation entry-point even from Board view.
- `Mod+T` (new session) and the wizard's "open sessions" navigation flip the center view to Sessions but leave the sidebar tab as-is, so users mid-flow (typing into a draft, finishing a wizard) don't have their sidebar context yanked.

## 3. Center Panel

> **Full specification:** [CENTER_PANEL.md](CENTER_PANEL.md)

The primary workspace area. Hosts a tab bar with session tabs and file tabs, renders Claude agent sessions via the Chat UI, and displays files via the File Viewer. Supports ephemeral preview tabs triggered by single-clicking items in the left panel trees.

Key features:
- **Session tabs** — each tab is an agent session with status dots and alert badges. The newly-active tab is auto-scrolled into view when `activeSessionId` changes.
- **`+ New` button** — sits at the right end of the tab bar (outside the scrollable area); creates a draft session and focuses it. Equivalent to `Mod+T`.
- **File tabs** — opened files with dirty indicators, separated from sessions by divider
- **Preview tabs** — ephemeral italic-titled tabs from single-click browsing, auto-close on navigation
- **Background alerts** — tab badges + toast notifications for sessions needing attention
- **File Viewer** — Monaco editor (code) or rendered markdown (`.md` files) with edit support

> **Chat UI details:** [CHAT_UI.md](CHAT_UI.md) — event rendering, message types, streaming, interactive cards
> **Center panel + "+ New" draft flow:** [CENTER_PANEL.md](CENTER_PANEL.md)

## 4. Right Panel — Context Panel

Toggle visibility: `Mod+J`

> **Full specification:** [CONTEXT_PANEL.md](CONTEXT_PANEL.md)

The right panel is a **context-aware sidebar** that auto-switches content based on what's active in the center panel. It has **no tabs** — instead, it renders stacked collapsible sections relevant to the current context.

### Context Modes

| Center panel shows | Right panel mode | Key sections |
|---|---|---|
| Spec file open or previewed | **Spec Context** | Connected specs subgraph, linked tasks, covered files, spec health |
| Active agent session | **Agent Context** | Task spec preview, files modified (live), related specs, compliance hints |
| Code file open or previewed | **Code Context** | Covering specs, related tasks, staleness indicator |
| Nothing selected | **Empty state** | Welcome message prompting user to select content |

Mode is derived from stores (`sessionStore`, `fileStore`, `specStore`). Only one thing is focused at a time — session, file, or preview are mutually exclusive. The context panel simply reflects what's currently shown in the center panel.

**Single-click context activation:** Clicking a file in FileTree or a spec in SpecTree opens a preview tab and immediately switches the context panel. This is the primary way users browse context. See [CENTER_PANEL.md — Preview Tabs](CENTER_PANEL.md#preview-tabs) for details.

### Peek-to-Center

Sections with rich content (graphs, full spec text) show a compact preview with a `[⇱]` button that opens the full view in the center panel. This solves the 380px width constraint while keeping context accessible.

### Previous Components (relocated)

The following views from the old tab-based right panel are now handled differently:

| Old tab | New location |
|---------|-------------|
| **Graph** | Compact "Connected Specs" subgraph in Spec Context mode. Full graph via `[⇱]` opens in center. See [GRAPH_INTERACTIONS.md](GRAPH_INTERACTIONS.md). |
| **Spec** | Spec files open in center panel FileViewer. See [CENTER_PANEL.md](CENTER_PANEL.md). |
| **Code** | Code files open in center panel FileViewer. See [CENTER_PANEL.md](CENTER_PANEL.md). |
| **Diff** | Available via DiffViewer in center panel. See [DIFF_VIEWER.md](DIFF_VIEWER.md). |
| **Console** | Removed from UI for now. Not core to spec-driven workflow. |

> **File Viewer, preview tabs, file tabs, and edit mode** are fully specified in [CENTER_PANEL.md](CENTER_PANEL.md).

## 5. Status Bar

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 🌿 N specs │ ● N done │ ⏳ N pending │        Mod+T New · Mod+B Tree  │
└──────────────────────────────────────────────────────────────────────────┘
```

Always visible at the bottom. Shows:
- Spec counts (total, done, pending)
- **"N sessions"** — clickable button that focuses the sidebar Sessions tab (uncollapsing the left panel if needed). The count is sourced from `sessionStore.sessionList` (the same `session/list` snapshot that backs the sidebar panel), so the pill and the panel always agree — including done/error/draft sessions. When background sessions exist, a chevron next to it toggles a dropdown listing them.
- Attention indicator when sessions need user input
- Keyboard shortcut hints

The session list itself lives in the sidebar Sessions tab — see §2.1.

## 6. Command Palette

Triggered by `Mod+K`. A floating search modal for quick navigation and actions:

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

**Modifier key:** `Mod` = Ctrl on macOS, Alt on Linux/Windows.

| Shortcut | Action |
| --- | --- |
| `Mod+K` | Open command palette |
| `Mod+B` | Toggle left panel |
| `Mod+J` | Toggle right panel |
| `Mod+T` | New session |
| `Mod+1-9` | Switch session tabs |
| `Mod+Enter` | Send message |
| `Mod+G` | Open full graph view in center panel |
| `Mod+P` | Open spec view in center panel |

## 8. Context Linking

The right panel (Context Panel) **automatically derives its mode and content** from the center panel state. There are no manual tabs to switch — the panel always shows the most relevant context.

**Mode derivation:** Only one thing is focused at a time — session, file, or preview are mutually exclusive. The context panel reflects what's shown in the center panel.

**Linking behavior:**
1. When a session starts → right panel switches to **Agent Context** (task spec, files modified, related specs, compliance). Any preview tab auto-closes.
2. When user single-clicks a spec in SpecTree → preview tab opens in center, right panel switches to **Spec Context**
3. When user single-clicks a file in FileTree → preview tab opens in center, right panel switches to **Code Context** (or Spec Context if it's a spec file)
4. When user double-clicks or opens a file fully → same context behavior, but tab is pinned (permanent)
5. When user clicks a pinned tab → preview tab auto-closes, context follows the pinned tab
6. When nothing is active → right panel shows **empty welcome state**
7. Clicking items in the right panel sections (specs, tasks, files) opens them as preview tabs in center, which triggers a context mode switch

See [CONTEXT_PANEL.md](CONTEXT_PANEL.md) for full specification.

## 9. Future Sub-Specifications

The following areas require their own detailed specs as the design matures:

| Component | Scope | Notes |
| --- | --- | --- |
| **Chat UI Rendering** | Detailed rendering rules for each agent event type, streaming behavior, markdown rendering, syntax highlighting | How tool cards expand/collapse, animation timings, error states |
| **Graph Interactions** | Layout algorithm, edge routing, node positioning, zoom/pan behavior, animation, force-directed vs hierarchical layout | Library choice (D3, React Flow, Cytoscape) |
| **Diff Viewer** | Spec-to-code correlation logic, commit navigation, inline vs side-by-side, change grouping | How to match spec sections to code files |
| **New Session Modal** | Skill registry integration, spec selector UI, session configuration options | Validation rules, default values |
| ~~**Console**~~ | ~~Terminal emulator~~ | Removed from UI for now — not core to spec-driven workflow |
| **Command Palette** | Fuzzy search algorithm, indexing strategy, action registry, keyboard navigation | Performance with large projects |
| **Notification System** | Toast queue management, priority ordering, sound configuration, persistence rules | Interaction with OS-level notifications |
| **Theming** | Color scheme, dark/light mode, customization | CSS variable system, user preferences |
| **Responsive Behavior** | Panel collapse rules at narrow widths, mobile considerations | Breakpoints, touch interactions |

## 10. Backend API Gaps

The following RPC methods and endpoints are referenced by frontend sub-specs but **not yet designed in the backend RPC module spec** (`backend/app/rpc/README.md`). These must be added before the corresponding frontend features can be implemented.

| Methods | Referenced By | Description |
| --- | --- | --- |
| `diff/mappings`, `diff/commit`, `diff/scan` | [Diff Viewer](DIFF_VIEWER.md) §3 | Spec-to-code mapping extraction from git history. Requires mapping file I/O. |
| `/terminal/create`, `/terminal/{id}/ws`, `/terminal/{id}/resize`, `/terminal/{id}/kill` | [Console](../src/components/Console/README.md) §Backend Integration | Terminal process management via PTY. Separate WebSocket per terminal (not JSON-RPC). Requires new FastAPI router. |

## Known Limitations

- **No offline mode:** Requires live WebSocket connection to backend for all functionality
- **Single user:** No multi-user collaboration or concurrent editing
- **Browser only:** No desktop app wrapper (Electron, Tauri) — runs in browser tab
- **English only:** No internationalization support in v1

## Related Specs

- **Parent:** [Frontend Module](../README.md)
- **Depends on:** [Goal & Requirements](../../GOAL&REQUIREMENTS.md)
- **Sub-specs:** [Chat UI](CHAT_UI.md), [Graph](GRAPH_INTERACTIONS.md), [Context Panel](CONTEXT_PANEL.md), [Center Panel](CENTER_PANEL.md), [Palette](COMMAND_PALETTE.md), [Notifications](NOTIFICATION_SYSTEM.md), [Diff](DIFF_VIEWER.md), [App Shell](APP_SHELL.md), [Theming](THEMING.md), [Responsive](RESPONSIVE_BEHAVIOR.md)