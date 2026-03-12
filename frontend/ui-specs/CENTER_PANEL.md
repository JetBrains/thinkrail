# Center Panel — UI Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-05 | Updated: 2026-03-05

## Overview

The center panel is the primary workspace in the three-panel layout. It hosts a tab bar with session and file tabs, renders Claude agent sessions as a streaming chat UI, and displays files via the File Viewer (Monaco editor for code, rendered markdown for `.md` files). It supports ephemeral preview tabs triggered by single-clicking items in the left panel trees.

```
+---------------------------------------------------------------------+
| [session-1 •] [session-2 •] | [📄 file.py] [📄 *preview.md* ×]   |
+---------------------------------------------------------------------+
|                                                                     |
|  Active tab content (one of):                                       |
|    - Session tab  -> ChatStream + SessionStatusLine + InputArea     |
|                      (or RestoredBar instead of InputArea)          |
|    - File tab     -> FileViewer (Monaco or MarkdownPreview)         |
|    - Preview tab  -> FileViewer (italic tab title)                  |
|    - No tabs      -> center-placeholder                             |
|                                                                     |
+---------------------------------------------------------------------+
```

---

## Component Hierarchy

```
<SessionPanel>                       components/SessionPanel/SessionPanel.tsx
  <SessionTabBar />                  components/SessionPanel/SessionTabBar.tsx
  {showFile}
    <FileViewer file={displayFile} />  components/FileViewer/FileViewer.tsx
  {showSession}
    <ChatStream ... />               components/ChatStream/ChatStream.tsx
    <SessionStatusLine ... />        components/ChatStream/SessionStatusLine.tsx
    {session.restored}
      <RestoredBar ... />            (inline in SessionPanel.tsx)
    {!session.restored}
      <InputArea ... />              components/ChatStream/InputArea.tsx
  {!showFile && !showSession}
    <div className="center-placeholder">
```

There is **no** `CenterPanel` directory or component. The component implementing the center panel is `SessionPanel`.

---

## Tab Bar — SessionTabBar

**File:** `components/SessionPanel/SessionTabBar.tsx`

Renders three zones in a single horizontal strip. Returns `null` when no sessions and no files.

### Props

```typescript
interface SessionTabBarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSwitchSession: (taskId: string) => void;
  onCloseSession: (taskId: string) => void;
  files: OpenFile[];
  activeFilePath: string | null;
  onSwitchFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  previewFile: OpenFile | null;
  previewFilePath: string | null;
  onClearPreview: () => void;
  onPinPreview: () => void;
}
```

### Session Tabs

- Status dot (`.session-tab-dot`): 6px circle — `running` → blue, `done` → green, `error` → red, else → hint
- Name (`.session-tab-name`): `max-width: 120px`, truncated
- Alert badge (`.session-tab-badge`): `Q` for question, `A` for approval, pulse animation
- Close button (`.session-tab-close`): hidden by default, visible on hover
- Active: `.session-tab-active` → purple bottom border

### Separator

`.session-tab-sep` (1px vertical line) between session tabs and file tabs when both exist.

### Pinned File Tabs

- 📄 icon + filename + dirty indicator (`●` gold when `isDirty`) + close button
- Active: `.session-tab-active` when `path === activeFilePath`

### Preview Tab

- Shown when `previewFilePath != null` and path not already pinned
- Name in *italic* (`.file-tab-preview .session-tab-name { font-style: italic }`)
- Double-click → `onPinPreview()` (converts to pinned tab)
- Close → `onClearPreview()`

---

## Preview Tabs

Ephemeral VS Code-style tabs opened by single-clicking items in left panel trees.

### Trigger

`fileStore.loadPreview(path)` → fetches content, sets `previewFilePath` and `previewFile`. If path already pinned, routes to `activateFile(path)` instead.

### Lifecycle

```
Single-click → loadPreview(path)
  ├── Already pinned → activateFile(path)
  └── Not pinned → preview tab appears (italic title)
       ├── Single-click another item → replaces preview
       ├── Double-click preview tab → pin it
       ├── Click session tab → clears preview
       ├── Click pinned file tab → clears preview
       └── Click × → clears preview
```

---

## Session Content

When `activeSession != null` and no file active:

```
<ChatStream events={...} answeredRequests={...} onResolveRequest={...} />
<SessionStatusLine model={...} permissionMode={...} metrics={...} status={...} />
{restored ? <RestoredBar /> : <InputArea />}
```

See [CHAT_UI.md](CHAT_UI.md) for detailed event rendering.

### Input Disabled Logic

```typescript
inputDisabled = isDone || isRunning || (hasPending && pendingRequest.type === "approval")
```

Input enabled for pending questions (user can type freetext answer).

### Send Behavior

- Pending question → `resolveRequest(taskId, requestId, { text })`
- Idle → `sendMessage(taskId, text)` (optimistic user message event + status → "running")

---

## Restored Session Bar

When `session.restored === true`, `InputArea` replaced by:

```
| This is a restored session (read-only)          [Resume Session] |
```

- "Resume Session" calls `session/continue` API → new session with old events, name + " (resumed)"
- Classes: `.restored-bar`, `.restored-bar-text`, `.restored-bar-btn`

---

## File Viewer

**File:** `components/FileViewer/FileViewer.tsx`

### OpenFile Shape

```typescript
interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  mode: "preview" | "edit";
  isDirty: boolean;
  saving: boolean;
  error?: string;
}
```

### Toolbar

Path + language badge + metadata (lines, KB) + Copy button + Edit/Save controls.

### Edit Dropdown

Options: Edit in place, Open in IntelliJ IDEA, Open in VS Code, Open in Vim.

### Content Rendering

- **Markdown** (`*.md` in preview mode): `<MarkdownPreview>` with `react-markdown` + `remark-gfm` + Mermaid diagrams
- **Code** (all other files, or markdown in edit mode): Monaco editor with `intellij-darcula` theme
- **Monaco options:** minimap enabled, lineNumbers on, fontSize 13, JetBrains Mono font, `automaticLayout: true`

### Markdown Preview Features

- Global zoom controls (50%–200%, sticky top-right)
- Per-diagram zoom controls (30%–300%, shown on diagram hover)
- Mermaid error handling (shows raw code + error message)
- User-resizable diagram wrappers (`resize: both`)

---

## Session Manager

**File:** `components/SessionManager/SessionManager.tsx`

Standalone component (not rendered inside `SessionPanel`). Receives `onClose` prop.

- Fetches sessions from backend via `session/list` RPC
- Groups into Active, Completed, Errors
- Actions: Switch to, Stop, Continue, Delete
- Click card → restore/switch session, then close

---

## Empty States

| Condition | Message |
|---|---|
| No sessions, no files | "Select a session or create a new one (Mod+T)" |
| Tabs exist, none active | "Select a tab" |
| Session Manager empty | "No sessions yet. Create one with Mod+T." |

---

## Store Integration

### fileStore

```typescript
interface FileStore {
  openFiles: Map<string, OpenFile>;
  activeFilePath: string | null;
  previewFilePath: string | null;
  previewFile: OpenFile | null;

  openFile(path): Promise<void>;
  closeFile(path): void;
  activateFile(path): void;      // sets activeFilePath, clears preview
  loadPreview(path): Promise<void>;
  clearPreview(): void;
  pinPreview(): void;            // move preview → openFiles
  setMode(path, mode): void;
  updateContent(path, content): void;
  saveFile(path): Promise<void>;
  openExternal(path, editor): Promise<void>;
}
```

### sessionStore

```typescript
interface SessionStore {
  sessions: Map<string, Session>;
  activeSessionId: string | null;
  archivedSessions: ArchivedSession[];

  startSession({specIds, config, name, skillId?}): Promise<string>;
  sendMessage(taskId, text): Promise<void>;
  switchSession(taskId): void;
  closeSession(taskId): void;
  resolveRequest(taskId, requestId, response): void;
  updateConfig(taskId, {model?, permissionMode?}): Promise<void>;
  restoreSession(taskId): Promise<void>;
}
```

### Content Switching Logic

```typescript
const activeSession = activeSessionId && !activeFilePath && !previewFilePath
  ? sessions.get(activeSessionId) : null;
const displayFile = activeFile ?? (previewFilePath ? previewFileObj : null);
const showFile = displayFile != null;
const showSession = activeSession != null && !showFile;
```

Session tab switching clears file state; file tab switching clears preview.

---

## CSS Classes

### Layout

| Class | Description |
|---|---|
| `.center-panel` | Flex column, `flex: 1`, `min-width: 300px` |
| `.center-placeholder` | Centered hint text for empty state |

### Tab Bar

| Class | Description |
|---|---|
| `.session-tabs` | Flex row, border-bottom, overflow-x auto |
| `.session-tab` | Individual tab (12px, 2px transparent bottom border) |
| `.session-tab-active` | Purple bottom border, `var(--text)` color |
| `.session-tab-dot` | 6px status circle |
| `.session-tab-name` | Truncated label (max 120px) |
| `.session-tab-badge` | Alert badge (Q/A, pulse animation) |
| `.session-tab-close` | Hidden until hover |
| `.session-tab-sep` | 1px vertical separator |
| `.file-tab-dirty` | Gold dot (unsaved changes) |
| `.file-tab-preview .session-tab-name` | Italic for preview tab |

### File Viewer

| Class | Description |
|---|---|
| `.fv` | Root container |
| `.fv-toolbar` | Toolbar row |
| `.fv-path` | File path (muted, ellipsis) |
| `.fv-lang-badge` | Language badge (blue tint) |
| `.fv-meta` | Line count, file size |
| `.fv-btn` / `.fv-btn-edit` / `.fv-btn-save` | Toolbar buttons |
| `.fv-editor-container` | Content area |
| `.fv-dropdown` | Edit options dropdown |
| `.md-preview-container` | Scrollable markdown wrapper |
| `.md-preview` | Markdown content area |
| `.md-zoom-bar` / `.md-zoom-btn` | Zoom controls |
| `.md-mermaid-wrapper` | Resizable diagram container |

---

## Keyboard Shortcuts

**Modifier key:** `Mod` = Ctrl on macOS, Alt on Linux/Windows.

| Shortcut | Action |
|---|---|
| `Mod+T` | Open New Session Modal |
| `Mod+K` | Open Command Palette |
| `Mod+J` | Toggle right panel |
| `Mod+B` | Toggle left panel |
| `Mod+Enter` (in InputArea) | Send message |
| `Mod+1-9` tab switching | **[Not implemented]** |

---

## Known Limitations

- **No split view** — cannot view file and session side-by-side
- **No tab reordering** — tabs ordered by creation order
- **Single preview tab** — cannot preview multiple files
- **Monaco lazy loading** — brief loading delay on first file open
- **No dirty-state guard on close** — no warning for unsaved changes
- **Session Manager standalone** — not integrated into center panel

---

## Sub-Specifications

| Sub-spec | Scope | Status |
|---|---|---|
| [Chat UI](CHAT_UI.md) | Event rendering, message components, streaming | Active |

---

## Related Specs

- **Parent:** [WEBVIEW.md](WEBVIEW.md)
- **Child:** [CHAT_UI.md](CHAT_UI.md)
- **Related:** [CONTEXT_PANEL.md](CONTEXT_PANEL.md), [APP_SHELL.md](APP_SHELL.md), [NEW_SESSION_MODAL.md](NEW_SESSION_MODAL.md), [SESSION_HISTORY.md](SESSION_HISTORY.md)
- **Depends on:** `store/sessionStore.ts`, `store/fileStore.ts`, `store/uiStore.ts`
