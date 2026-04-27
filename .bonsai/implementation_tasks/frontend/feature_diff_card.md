---
id: task-fe-diff-card
type: task-spec
status: done
title: Implement DiffCard
depends-on:
- task-fe-chat-ui
implements:
- chat-ui
covers:
- frontend/src/components/ChatStream/DiffCard.tsx
- frontend/src/components/ChatStream/DiffCard.css
- backend/app/agent/runner.py
tags:
- medium
- new-feature
- frontend
---
# Implement DiffCard

> Monaco DiffEditor-based component for Edit/Write/NotebookEdit tool calls

**Status:** Done
**Priority:** Medium
**Depends on:** `feature_chat_ui`
**Spec reference:** `frontend/ui-specs/CHAT_UI.md`

## Summary

Replace the generic `<ToolCallCard>` rendering for Edit, Write, and NotebookEdit tool calls with a dedicated `<DiffCard>` component that uses Monaco's `DiffEditor` to show side-by-side diffs. For the Write tool, the backend injects `_previousContent` (the file's content before the write) into `toolInput` so the frontend can show a meaningful diff. The component is lazy-loaded via `React.lazy` to keep the Monaco bundle out of the critical path, and uses horizontal scrolling (min-width 900px) to ensure the side-by-side diff is usable on narrow viewports.

## Files Created/Modified

| File | Change |
|------|--------|
| `frontend/src/components/ChatStream/DiffCard.tsx` | **New** — DiffCard component |
| `frontend/src/components/ChatStream/DiffCard.css` | **New** — DiffCard styles |
| `frontend/src/components/ChatStream/ChatStream.tsx` | Route Edit/Write/NotebookEdit to DiffCard |
| `frontend/src/components/ChatStream/SubagentBlock.tsx` | Route Edit/Write/NotebookEdit to DiffCard (compact variant) |
| `backend/app/agent/runner.py` | Inject `_previousContent` for Write tool calls |

## Key Implementation Details

### DiffData extraction per tool

| Tool | `filePath` source | `original` | `modified` |
|------|-------------------|------------|------------|
| Edit | `file_path` | `old_string` | `new_string` |
| Write | `file_path` | `_previousContent` (injected by backend) | `content` |
| NotebookEdit | `notebook_path` | `old_source` | `new_source` / `source` |

### Routing logic

- `DIFF_TOOLS = new Set(["Edit", "Write", "NotebookEdit"])` — defined in both ChatStream.tsx and SubagentBlock.tsx
- `DiffCard` is lazy-loaded: `const DiffCard = lazy(() => import("./DiffCard.tsx").then(m => ({ default: m.DiffCard })))`
- Wrapped in `<Suspense>` with a `<ToolCallCard>` fallback (shows running state while Monaco loads)

### Monaco DiffEditor configuration

```typescript
options={{
  readOnly: true,
  renderSideBySide: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  lineNumbers: "on",
  automaticLayout: true,
  enableSplitViewResizing: true,
  ignoreTrimWhitespace: false,
}}
```

Uses the `intellij-darcula` custom theme (same as FileViewer).

### Large file guard

Files where `original.length + modified.length > 100KB` show a warning with a "Load diff anyway" button instead of immediately loading the editor.

### Binary file fallback

Files with binary extensions (png, jpg, zip, exe, etc.) fall back to a simple text display instead of the diff editor.

### Horizontal scrolling

The editor container has `min-width: 900px` with `overflow-x: auto` on the scroll wrapper, ensuring the side-by-side diff remains usable even in narrow viewports.

### Compact variant

When `compact={true}` (inside SubagentBlock), the card uses reduced padding, smaller font, and a smaller default editor height (200px vs 300px, min-width 700px vs 900px).

### Backend: _previousContent injection

In `runner.py`, when a `Write` tool call is detected, the backend reads the target file's current content and injects it as `_previousContent` into the `toolInput` payload before emitting `agent/toolCallStart`. This allows the frontend to show what the file looked like before the write.

### Resize behavior

The editor container has `resize: vertical` and a `ResizeObserver` syncs the container height to the Monaco `height` prop, supporting user-driven vertical resizing.

## Definition of Done

- [x] DiffCard component renders Monaco DiffEditor for Edit/Write/NotebookEdit
- [x] extractDiffData correctly maps each tool's input fields to original/modified
- [x] Backend injects `_previousContent` for Write tool calls
- [x] ChatStream routes diff tools to DiffCard with Suspense fallback
- [x] SubagentBlock routes diff tools to DiffCard compact variant
- [x] Large file guard prevents slow loads (>100KB threshold)
- [x] Binary files fall back gracefully
- [x] Horizontal scroll ensures usability on narrow viewports
- [x] Lazy loading keeps Monaco out of initial bundle
