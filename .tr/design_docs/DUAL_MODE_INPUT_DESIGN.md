---
id: dual-mode-input-design
type: architecture-design
status: active
title: Markdown Input with Split-Pane Preview — Architecture Design
parent: design-doc
depends-on:
- module-agent
- module-rpc
covers:
- frontend/src/components/ChatStream/InputArea.tsx
- frontend/src/components/ChatStream/ChatStream.tsx
- frontend/src/components/ChatStream/ChatStream.css
- frontend/src/store/sessionStore.ts
- frontend/src/api/methods/agents.ts
- backend/app/rpc/methods/agents.py
- backend/app/agent/service.py
tags:
- feature
- markdown
- input
- split-pane
---
# Markdown Input with Split-Pane Preview — Architecture Design

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11 | Updated: 2026-03-12

## Table of Contents
1. [Overview](#overview)
2. [Layout Architecture](#layout-architecture)
3. [Data Flow](#data-flow)
4. [Changes by Layer](#changes-by-layer)
5. [Keyboard Shortcuts](#keyboard-shortcuts)
6. [Panel Resize](#panel-resize)
7. [Split-Pane Resize](#split-pane-resize)
8. [Key Design Decisions](#key-design-decisions)
9. [Migration from Dual-Mode](#migration-from-dual-mode)
10. [Feature & Task Specs](#feature--task-specs)

## Overview

The input area is **always in markdown mode**. There is no text/markdown toggle — every message is sent as markdown. The formatting toolbar is always visible, and a **Preview** toggle button enables a side-by-side split-pane view where the textarea and a live-rendered preview appear next to each other horizontally.

- **Default state**: toolbar + textarea (full width). All formatting shortcuts (Mod+B/I/K) are always active.
- **Preview toggled on**: textarea and rendered preview appear side by side in a split pane with a draggable divider. The textarea is always visible — the preview supplements, never replaces it.
- **Rendering**: `UserMessageBubble` checks `isMarkdown` — if true, renders via `ChatMarkdown` with a hover-visible raw/rendered toggle button. Legacy messages with `isMarkdown: false` (or missing) render as plain text.

## Layout Architecture

### Default (Preview Off)
```
┌──────────────────────────────────────────────┐
│ ┌ Preview | ── B I </> 🔗 H • 1. ❝ — ``` ──┐│
│ │ [textarea ·································]││
│ │ [                                          ]││
│ └────────────────────────────────────────────┘│
│                                [↑] [🎙] [Send]│
└──────────────────────────────────────────────┘
```

### Preview Toggled On (Split Pane)
```
┌──────────────────────────────────────────────┐
│ ┌ Preview* | ── B I </> 🔗 H • 1. ❝ — ``` ─┐│
│ │ [textarea ·······] │▌│ Rendered markdown  ││
│ │ [                ] │▌│ output (ChatMd)    ││
│ └────────────────────────────────────────────┘│
│                                [↑] [🎙] [Send]│
└──────────────────────────────────────────────┘

           ← 20% ─── │▌│ ─── 80% →  (draggable, clamped)
```

### User Bubble with Markdown Toggle
```
                               ┌─────────────────────┐
                               │ [raw]        (hover) │
                               │ Rendered **markdown** │
                               │ content via ChatMd   │
                               └─────────────────────┘
```

## Data Flow

### Send Path
```
InputArea.handleSend(text, isMarkdown=true)      ← always true now
  → SessionPanel.handleSend(text, isMarkdown)
    → sessionStore.sendMessage(thinkrailSid, text, isMarkdown)
      ├── optimistic event: { eventType: "userMessage", payload: { text, isMarkdown: true } }
      └── api.send(thinkrailSid, text, isMarkdown)
            → RPC: agent/send { thinkrailSid, text, isMarkdown }
              → agents.py: send_message(service, thinkrailSid, text, isMarkdown)
                → service.send_message(thinkrailSid, text, is_markdown=True)
                  → persistence: append_event({ eventType: "userMessage", payload: { text, isMarkdown: true } })
                  → tracker.enqueue_message(thinkrailSid, text)
```

### Render Path
```
ChatStream receives events[]
  → event.eventType === "userMessage"
    → <UserMessageBubble text={p.text} isMarkdown={p.isMarkdown ?? false} />
      ├── isMarkdown=false → <div className="chat-user-text">{text}</div>      (legacy messages)
      └── isMarkdown=true  → <div className="chat-user-text--md"><ChatMarkdown content={text} /></div>
                              + <button className="chat-user-toggle"> raw / md </button>  (visible on hover)
```

## Changes by Layer

### Frontend — InputArea.tsx

| Aspect | Detail |
|--------|--------|
| Removed | `InputMode` type, `inputMode` state, `isMd` derived boolean, `toggleMode()` callback, `Md` toggle button, `Ctrl+Shift+M` shortcut, `Write` tab button |
| Added | `splitRatio` state (default `0.5`), `splitPaneRef` ref, `handleSplitDragStart()` drag handler |
| Changed | Toolbar always renders (no `isMd` guard). Preview is a toggle button (not a tab). Format shortcuts (Mod+B/I/K) always active (no mode guard). `handleSend` always passes `isMarkdown=true`. |
| State | `previewActive` (boolean), `splitRatio` (number, 0.2–0.8), `panelHeight` (number|null) |

### Frontend — ChatStream.css

| Class | Role |
|-------|------|
| `.input-split-pane` | Flex container for textarea + divider + preview |
| `.input-split-divider` | 5px-wide vertical drag handle, `cursor: col-resize` |
| `.input-textarea--split` | Bottom-left-only border-radius when preview visible |
| `.input-preview` | Right pane — bottom-right border-radius, no left/top border |
| Removed | `.input-mode-btn`, `.input-mode-btn--active`, `.input-mode-btn:hover` |

### Frontend — No Other Changes

`ChatStream.tsx`, `SessionPanel.tsx`, `sessionStore.ts`, `agents.ts` are **unchanged** — the `isMarkdown` parameter already existed in all interfaces. The only difference is that `InputArea` now always sends `true`.

### Backend — No Changes

The backend layer (`agents.py`, `service.py`) already handles `isMarkdown` as an optional boolean. No backend changes required.

## Keyboard Shortcuts

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

| Shortcut | Context | Action |
|----------|---------|--------|
| `Mod+B` | Always | Insert bold markers `**text**` |
| `Mod+I` | Always | Insert italic markers `*text*` |
| `Mod+K` | Always | Insert link markers `[text](url)` |
| `Mod+Enter` | Textarea or preview pane | Send message |
| `Mod+R` | Textarea | Toggle message history popup |

Removed: `Mod+Shift+M` (no mode toggle needed).

All shortcuts use `isMod(e)` (`e.metaKey || e.ctrlKey`) for cross-platform compatibility. Formatting shortcuts wrap the current selection (or insert placeholder "text" if nothing is selected).

## Panel Resize

The input area includes a **vertical drag handle** at its top edge for manual height control:

- **Drag handle**: a 7px-tall invisible hit area (`.input-resize-handle`) positioned absolutely at `top: -3px`. A 32×3px pill indicator appears on hover/active.
- **Drag behavior**: `mousedown` captures `startY` and `startHeight`, then tracks `mousemove` to compute `delta = startY - ev.clientY`. New height is clamped between `56px` and `70vh`.
- **Manual mode** (`panelHeight !== null`): the panel gets a fixed `height` via inline style. The textarea and preview pane fill available space via flex (`--fill` modifiers). Side buttons (history, mic, Send) align to `flex-end`.
- **Auto mode** (`panelHeight === null`): default behavior — textarea auto-expands with content via `scrollHeight` measurement on input.
- **Double-click**: resets to auto mode (`setPanelHeight(null)`) and recalculates textarea height.

## Split-Pane Resize

When preview is active, a **horizontal drag divider** separates the textarea and preview:

- **Divider** (`.input-split-divider`): 5px-wide bar between textarea and preview. `cursor: col-resize`. Highlights with `var(--cyan)` on hover/active.
- **Drag behavior**: `mousedown` captures `startX`, current `splitRatio`, and container width. `mousemove` computes `newRatio = startRatio + (ev.clientX - startX) / paneWidth`, clamped to `[0.2, 0.8]`.
- **Implementation**: textarea gets `style={{ flex: splitRatio }}`, preview gets `style={{ flex: 1 - splitRatio }}`. Default is `0.5` (equal split).
- **During drag**: `document.body.style.cursor = "col-resize"` and `userSelect = "none"` prevent text selection artifacts.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Always markdown | Removed text mode entirely | The two-mode toggle was redundant — text mode was just markdown without the toolbar. Simplifies state management and eliminates a confusing UI toggle. |
| Split-pane preview | Side-by-side instead of tab-switch | Tab-based Write/Preview forced users to switch away from the editor to see output. Side-by-side lets users edit and preview simultaneously — a pattern proven in VS Code, GitHub, and every modern markdown editor. |
| Draggable split ratio | Flex-based with mouse capture | Same proven pattern as the vertical panel resize. Clamped 20–80% to prevent either pane from becoming unusably small. |
| `isMarkdown` still threaded | Keep boolean in persistence | Backward-compatible — old messages with `isMarkdown: false` or `undefined` still render as plain text. New messages always get `true`. |
| Reuse existing `ChatMarkdown` | No new rendering dependencies | `ChatMarkdown` (react-markdown + rehype/remark plugins) already handles all markdown features for assistant messages |
| Preview state is ephemeral | Not persisted to store | Whether the preview pane is open is a transient editing preference. Resets on send. |
| Backend is format-agnostic | Just threads `isMarkdown` through to persistence | Backend doesn't parse, validate, or transform markdown. It's a client-side rendering concern stored as metadata |

## Migration from Dual-Mode

This design **supersedes** the original dual-mode architecture. Key removals:

| Removed | Reason |
|---------|--------|
| `type InputMode = "text" \| "markdown"` | No mode concept needed |
| `inputMode` state + `isMd` derived boolean | Always markdown |
| `toggleMode()` callback | Nothing to toggle |
| `Md` button (`.input-mode-btn`) | No mode toggle UI |
| `Mod+Shift+M` shortcut | No mode toggle shortcut |
| `Write` tab button | Textarea is always visible; no need for a tab to switch to it |
| `isMd` guard on format shortcuts | Shortcuts always active |

What was kept: toolbar, format buttons, preview rendering, `previewActive` state, `insertFormat()`, all panel resize logic, `Mod+Enter` from preview.

## Feature & Task Specs

| Component | Spec | Description |
|-----------|------|-------------|
| Original task | [feature_dual_mode_input.md](../../.tr/implementation_tasks/frontend/feature_dual_mode_input.md) | Original dual-mode implementation (Done, superseded) |
| Refactor task | [feature_split_pane_preview.md](../../.tr/implementation_tasks/frontend/feature_split_pane_preview.md) | Remove text mode, add split-pane preview |
