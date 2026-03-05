# Center Panel — UI Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-05

## Table of Contents
1. [Purpose](#purpose)
2. [Overview](#overview)
3. [Tab Bar](#tab-bar)
4. [Preview Tabs](#preview-tabs)
5. [File Viewer](#file-viewer)
6. [Session Content](#session-content)
7. [Session Manager](#session-manager)
8. [Empty States](#empty-states)
9. [Store Integration](#store-integration)
10. [Design Decisions](#design-decisions)
11. [Known Limitations](#known-limitations)
12. [Implementation Notes](#implementation-notes)
13. [Sub-Specifications](#sub-specifications)
14. [Related Specs](#related-specs)

## Purpose

The Center Panel is the primary workspace area in the three-panel layout. It hosts a tab bar with session tabs and file tabs, renders Claude agent sessions via the Chat UI, and displays files via the File Viewer (Monaco editor for code, rendered markdown for `.md` files). It also supports ephemeral preview tabs triggered by single-clicking items in the left panel trees.

## Overview

```
+---------------------------------------------------------------------+
| [session-1] [session-2] | [file.py] [*preview.md*]  [+]            |
+---------------------------------------------------------------------+
|                                                                     |
|  Active tab content:                                                |
|    - Session tab  -> ChatStream + StatusLine + InputArea            |
|    - File tab     -> FileViewer (Monaco or Markdown)                |
|    - Preview tab  -> FileViewer (same rendering, italic tab title)  |
|    - No tabs      -> Empty placeholder                              |
|                                                                     |
+---------------------------------------------------------------------+
```

The center panel is implemented as `SessionPanel` (component name is historical — it now handles both sessions and files). It renders `SessionTabBar` at the top and switches content based on which tab is active.

## Tab Bar

The `SessionTabBar` renders two groups of tabs separated by a vertical divider:

### Session Tabs
- Each tab represents an agent session (started via `agent/run`)
- Shows: session name + status dot (colored by state)
- Status dot colors: blue=running, green=done, red=error, gray=idle
- **Alert badge**: when a non-active session needs attention, its tab shows a badge:
  - `Q` = question pending (`agent/askUserQuestion`)
  - `A` = approval pending (`agent/confirmAction`)
- Close button (`x`) on each tab (with confirmation if session is running)
- `+` button or `Cmd+T` opens the new session modal
- `Cmd+1-9` switches between session tabs

### File Tabs
- Rendered after session tabs, separated by `|` divider
- Each tab: file icon + filename + dirty dot (gold, if modified) + close button
- Only one tab is active at a time (either a session tab OR a file tab, never both)
- Clicking a session tab deactivates the file tab and vice versa

### Tab Interactions
| Action | Result |
|--------|--------|
| Click session tab | Activates session, deactivates file tab, clears preview |
| Click file tab | Activates file, deactivates session tab, clears preview |
| Click preview tab | Activates preview content (already showing) |
| Close tab | Removes tab, activates nearest remaining tab |
| `Cmd+1-9` | Switches to nth session tab |

## Preview Tabs

Preview tabs are ephemeral, VS Code-style tabs created by single-clicking items in the left panel trees. They provide instant context feedback without cluttering the tab bar.

### Trigger
- **Single-click file in FileTree** -> preview tab opens for that file
- **Single-click spec in SpecTree** -> preview tab opens for that spec file

### Visual Distinction
- Preview tab title is rendered in *italic* (vs bold for pinned tabs)
- Only **one** preview tab exists at a time — single-clicking another item replaces it

### Lifecycle

```
Single-click file/spec in tree
  |
  v
Preview tab appears (italic title)
  |
  +-- Single-click another item --> replaces preview
  +-- Double-click same item -----> pins tab (italic -> bold, becomes permanent)
  +-- Double-click tree item -----> pins directly (skips preview)
  +-- Click a pinned tab ---------> preview auto-closes, context follows pinned tab
  +-- Start/switch session -------> preview auto-closes
  +-- Close button (x) -----------> preview removed
```

### Context Panel Integration
Preview tabs update the context panel (right sidebar) immediately:
- Preview a spec file -> context panel switches to **Spec Context**
- Preview a code file -> context panel switches to **Code Context**

The `useContextMode` hook reads `previewFilePath ?? activeFilePath` as the "effective file" — preview takes priority so context updates on single-click.

## File Viewer

The `FileViewer` component renders file content in the center panel. It handles both code files (Monaco editor) and markdown files (rendered HTML preview).

### Toolbar

```
+---------------------------------------------------------------------+
| path/to/file.py  [Python]  142 lines  4.2 KB         [Copy] [Edit] |
+---------------------------------------------------------------------+
```

- **File path**: relative to project root
- **Language badge**: detected from file extension
- **Line count** and **file size** (KB)
- **Copy button**: copies file content to clipboard (shows "Copied!" for 2s)
- **Edit button**: opens dropdown with editing options

### Preview Mode (default)

**Code files:** Read-only Monaco editor with:
- IntelliJ Darcula theme (custom registered theme)
- Syntax highlighting, line numbers, minimap
- Bracket pair colorization, indent guides
- Font: JetBrains Mono / Fira Code / SF Mono, 13px
- Smooth scrolling, cursor animation
- `Cmd+F` search

**Markdown files:** Rendered HTML preview via `react-markdown` + `remark-gfm`:
- GFM support: tables, task lists, strikethrough
- Mermaid diagrams: fenced ` ```mermaid ` blocks rendered as SVG with dark theme
- JetBrains-inspired typography
- **Zoom controls**:
  - Global zoom (top-right): scales font-size for entire document
  - Per-diagram zoom (hover to reveal): scales individual Mermaid SVGs
  - Both support +/-/reset, range 50%-200% (doc) / 30%-300% (diagram)

### Edit Dropdown

The "Edit" button opens a dropdown with options:
- **Edit in place** -> switches Monaco to `readOnly: false`
- **Open in IntelliJ IDEA** -> `POST /api/file/open-external` with `editor: "idea"`
- **Open in VS Code** -> same with `editor: "code"`
- **Open in Vim** -> same with `editor: "vim"`

Dropdown closes on outside click.

### Edit Mode

- Same Monaco editor with `readOnly: false`
- Tab shows dirty indicator (gold dot) when content differs from saved
- **Save button** -> `POST /api/file/write` -> clears dirty state
- **Cancel button** -> reverts to original content, switches back to preview mode

### Supported Languages

Python, TypeScript/TSX, JavaScript/JSX, CSS, HTML, JSON, Markdown, YAML, Shell, SQL, Rust, Go, Java, Kotlin, Ruby, XML

### IntelliJ Darcula Theme

| Token | Color | Hex |
|-------|-------|-----|
| Keywords | Orange | #CF8E6D |
| Strings | Green | #6AAB73 |
| Comments | Gray italic | #7A7E85 |
| Functions | Blue | #56A8F5 |
| Types | Purple | #C77DBB |
| Numbers | Teal | #2AACB8 |

## Session Content

When a session tab is active, the center panel renders the Chat UI:

```
+---------------------------------------------------------------------+
| <ChatStream>                                                        |
|   - Assistant messages (streamed markdown)                          |
|   - Tool call cards (collapsible)                                   |
|   - Subagent blocks (nested, indented)                              |
|   - Question/approval cards (interactive)                           |
|   - Completion/error banners                                        |
+---------------------------------------------------------------------+
| <SessionStatusLine>                                                 |
|   model | $cost | tool calls | context usage bar                   |
+---------------------------------------------------------------------+
| <InputArea>                                                         |
|   [Message Claude...]                                    [Send]     |
+---------------------------------------------------------------------+
```

For restored sessions, the `InputArea` is replaced with a `RestoredBar` showing a "Resume Session" button.

> **Full specification:** [CHAT_UI.md](CHAT_UI.md) — covers event rendering, message types, interactive cards, streaming behavior.

## Session Manager

Accessible by clicking "N sessions" in the status bar. Replaces center panel content with a list of all sessions.

- **Grouped by status:** Active (idle/running) -> Completed (done) -> Errors
- **Per session card:** name, status badge, model, created time, cost/turns
- Clicking a session card switches to that session tab

## Empty States

| Condition | Display |
|-----------|---------|
| No sessions and no files open | "Select a session or create a new one (Cmd+T)" |
| Tabs exist but none selected | "Select a tab" |

## Store Integration

The center panel reads from two stores:

### fileStore
- `openFiles: Map<string, OpenFile>` — pinned file tabs
- `activeFilePath: string | null` — currently active file tab
- `previewFilePath: string | null` — single-click preview path (at most one)
- `previewFile: OpenFile | null` — loaded content for the preview tab
- `openFile(path)` — fetch + add to openFiles (pinned)
- `activateFile(path)` — switch to file tab, calls `clearPreview()`
- `loadPreview(path)` — open as preview tab (replaces existing preview). If file already pinned, activates it instead.
- `clearPreview()` — remove preview tab
- `pinPreview()` — convert preview to pinned tab

### sessionStore
- `sessions: Map<string, Session>` — all active sessions
- `activeSessionId: string | null` — currently active session tab
- `switchSession(taskId)` — activate session tab

### Content switching logic (in SessionPanel)
```
if activeFilePath (or previewFilePath) -> show FileViewer
else if activeSessionId -> show ChatStream + StatusLine + InputArea
else -> show empty placeholder
```

When switching to a session tab, `activeFilePath` is cleared. When switching to a file tab, the session tab is deactivated visually (but session keeps running in background).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Preview tabs (single-click) | Ephemeral italic tab, auto-closes on navigation | Two equal goals: instant context panel feedback while browsing, and reduced tab clutter. Follows VS Code's proven preview tab pattern. |
| Single component for sessions + files | `SessionPanel` handles both | Simpler than separate components — they share the same tab bar and content area. Historical naming kept to avoid churn. |
| Monaco for code, react-markdown for .md | Different renderers per file type | Monaco provides IDE-quality editing. Markdown files benefit from rendered preview with Mermaid support. |
| IntelliJ Darcula theme | Custom Monaco theme matching JetBrains palette | Familiar to target users (JetBrains IDE users). Consistent with app's dark theme. |
| Edit via dropdown | Edit in place + external editors | Users may prefer their own editor. "Edit in place" for quick fixes, external editors for serious editing. |
| Only one active tab | Session OR file, never both | Simplifies state management. Context panel can only show one thing. Center panel has one content area. |
| Preview auto-close on tab switch | Clicking pinned tab closes preview | Preview is for browsing — once user commits to a pinned tab, the ephemeral preview is no longer needed. Keeps tab bar clean. |

## Known Limitations

- **No split view:** Cannot view a file and a session side-by-side in the center panel
- **No tab reordering:** Tabs are ordered by creation time (sessions first, then files)
- **Preview tab doesn't support edit mode:** Must pin first, then edit
- **Single preview tab:** Cannot preview multiple files simultaneously
- **Monaco lazy loading:** First file open has a brief loading delay while Monaco initializes

## Implementation Notes

- The center panel component is `SessionPanel` (not `CenterPanel`) — located at `components/SessionPanel/SessionPanel.tsx`
- `SessionTabBar` is a child component in the same directory
- `FileViewer` is at `components/FileViewer/FileViewer.tsx` with sub-components: `EditDropdown.tsx`, `MarkdownPreview.tsx`, `intellijTheme.ts`, `languageMap.ts`
- Chat UI components are at `components/ChatStream/` — see [CHAT_UI.md](CHAT_UI.md)
- The `previewFilePath`/`previewFile` state and related actions (`loadPreview`, `clearPreview`, `pinPreview`) are implemented in `fileStore`
- Monaco theme is registered once on first editor mount via `useRef` flag

## Sub-Specifications

| Sub-spec | Scope | Status |
|----------|-------|--------|
| [Chat UI](CHAT_UI.md) | Session rendering: event types, message components, streaming, interactions | Active |
| File Viewer | Monaco config, markdown rendering, edit mode, supported languages | Covered here (extract to own spec if it grows) |
| Preview Tabs | Lifecycle, store integration, auto-close rules | Covered here |

## Related Specs

- **Parent:** [WEBVIEW.md](WEBVIEW.md) — overall UI layout
- **Child:** [CHAT_UI.md](CHAT_UI.md) — session rendering details
- **Related:** [CONTEXT_PANEL.md](CONTEXT_PANEL.md) — reads `previewFilePath ?? activeFilePath` for mode derivation
- **Related:** [APP_SHELL.md](APP_SHELL.md) — three-panel layout, `<SessionPanel />` placement
- **Depends on:** [State Management](../src/store/README.md) — fileStore, sessionStore
- **Related:** [DIFF_VIEWER.md](DIFF_VIEWER.md) — diff view rendered in center panel
- **Related:** [NEW_SESSION_MODAL.md](NEW_SESSION_MODAL.md) — creates new session tabs
- **Related:** [SESSION_HISTORY.md](SESSION_HISTORY.md) — archived sessions open as read-only tabs
