# Dual-Mode Message Input — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Two-Mode Architecture](#two-mode-architecture)
3. [Data Flow](#data-flow)
4. [Changes by Layer](#changes-by-layer)
5. [Keyboard Shortcuts](#keyboard-shortcuts)
6. [Panel Resize](#panel-resize)
7. [Key Design Decisions](#key-design-decisions)
8. [Feature & Task Specs](#feature--task-specs)

## Overview

Dual-mode message input adds a **markdown editing mode** alongside the default plain-text mode in `InputArea`. Users toggle between modes via a button or shortcut. Markdown mode provides a formatting toolbar, Write/Preview tabs, and live preview powered by the existing `ChatMarkdown` component. An `isMarkdown` boolean flag is threaded through the entire stack so that markdown-authored messages render with full formatting in the chat stream.

- **Text mode** (default): single-row auto-expanding textarea — existing behavior, unchanged.
- **Markdown mode**: toolbar with Write/Preview tabs, 10 formatting buttons, and live preview pane. Textarea gains markdown-specific shortcuts (Mod+B/I/K).
- **Rendering**: `UserMessageBubble` checks `isMarkdown` — if true, renders via `ChatMarkdown` with a hover-visible raw/rendered toggle button.

## Two-Mode Architecture

### Text Mode Layout
```
┌──────────────────────────────────────────────┐
│ [Md]  [textarea ···························] │
│       [                                    ] │
│                              [↑] [🎙] [Send] │
└──────────────────────────────────────────────┘
```

### Markdown Mode — Write Tab
```
┌──────────────────────────────────────────────┐
│ [Md*] ┌ Write | Preview | ── B I </> 🔗 H … ┐│
│       │ [textarea ·························] ││
│       │ [                                  ] ││
│       └──────────────────────────────────────┘│
│                              [↑] [🎙] [Send] │
└──────────────────────────────────────────────┘
```

### Markdown Mode — Preview Tab
```
┌──────────────────────────────────────────────┐
│ [Md*] ┌ Write | Preview* | ── B I </> 🔗 H …┐│
│       │  Rendered markdown output            ││
│       │  (ChatMarkdown)                      ││
│       └──────────────────────────────────────┘│
│                              [↑] [🎙] [Send] │
└──────────────────────────────────────────────┘
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
InputArea.handleSend(text, isMarkdown=true)
  → SessionPanel.handleSend(text, isMarkdown)
    → sessionStore.sendMessage(bonsaiSid, text, isMarkdown)
      ├── optimistic event: { eventType: "userMessage", payload: { text, isMarkdown: true } }
      └── api.send(bonsaiSid, text, isMarkdown)
            → RPC: agent/send { bonsaiSid, text, isMarkdown }
              → agents.py: send_message(service, bonsaiSid, text, isMarkdown)
                → service.send_message(bonsaiSid, text, is_markdown=True)
                  → persistence: append_event({ eventType: "userMessage", payload: { text, isMarkdown: true } })
                  → tracker.enqueue_message(bonsaiSid, text)
```

### Render Path
```
ChatStream receives events[]
  → event.eventType === "userMessage"
    → <UserMessageBubble text={p.text} isMarkdown={p.isMarkdown ?? false} />
      ├── isMarkdown=false → <div className="chat-user-text">{text}</div>
      └── isMarkdown=true  → <div className="chat-user-text--md"><ChatMarkdown content={text} /></div>
                              + <button className="chat-user-toggle"> raw / md </button>  (visible on hover)
```

## Changes by Layer

### Frontend

| File | Change |
|------|--------|
| `InputArea.tsx` | `InputMode` type, `inputMode`/`previewActive`/`panelHeight` state, `toggleMode()`, `insertFormat()`, `Md` toggle button, Write/Preview tabs, 10-button formatting toolbar (`FORMAT_ACTIONS`), preview pane with `ChatMarkdown`, drag-to-resize handle, `handleDragStart`/`handleDragDoubleClick`, Mod+Shift+M / Mod+B / Mod+I / Mod+K shortcuts, Mod+Enter from preview, `isManual` flex mode |
| `ChatStream.tsx` | `UserMessageBubble` component — dual rendering path (plain text vs `ChatMarkdown`), `showRaw` state toggle, `chat-user-toggle` button visible on hover |
| `ChatStream.css` | ~15 class groups: `.input-mode-btn`, `.input-editor-wrapper`, `.input-md-toolbar`, `.input-md-tab`, `.input-md-sep`, `.input-md-fmt`, `.input-preview`, `.input-preview-empty`, `.input-preview--fill`, `.input-textarea--md`, `.input-editor-wrapper--fill`, `.input-area--manual`, `.input-resize-handle`, `.chat-user-bubble`, `.chat-user-text--md`, `.chat-user-toggle` |
| `SessionPanel.tsx` | `handleSend` callback accepts `(text, isMarkdown?)` and passes through to `sendMessage` |

### Store / API

| File | Change |
|------|--------|
| `sessionStore.ts` | `sendMessage` signature: `(bonsaiSid, text, isMarkdown?) → void`. Optimistic event includes `isMarkdown` in payload. |
| `agents.ts` | `send` function: `(bonsaiSid, text, isMarkdown?) → request`. Conditionally includes `isMarkdown` in RPC params. |

### Backend

| File | Change |
|------|--------|
| `rpc/methods/agents.py` | `send_message`: extracts `isMarkdown` from params with `params.get("isMarkdown", False)`, passes to `service.send_message()` as keyword arg |
| `agent/service.py` | `send_message`: accepts `is_markdown: bool = False` keyword arg, includes `"isMarkdown": is_markdown` in persisted `userMessage` event payload |

No changes to: `runner.py`, `tracker.py`, `models.py`, `context.py`, `persistence.py`.

## Keyboard Shortcuts

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

| Shortcut | Context | Action |
|----------|---------|--------|
| `Mod+Shift+M` | Any mode | Toggle between text and markdown mode |
| `Mod+B` | Markdown mode | Insert bold markers `**text**` |
| `Mod+I` | Markdown mode | Insert italic markers `*text*` |
| `Mod+K` | Markdown mode | Insert link markers `[text](url)` |
| `Mod+Enter` | Any mode, including preview pane | Send message |

All shortcuts use `e.metaKey || e.ctrlKey` for cross-platform compatibility. Formatting shortcuts wrap the current selection (or insert placeholder text if nothing is selected).

## Panel Resize

The input area includes a **drag handle** at its top edge for manual height control:

- **Drag handle**: a 7px-tall invisible hit area (`.input-resize-handle`) positioned absolutely at `top: -3px`. A 32×3px pill indicator appears on hover/active.
- **Drag behavior**: `mousedown` captures `startY` and `startHeight`, then tracks `mousemove` to compute `delta = startY - ev.clientY`. New height is clamped between `56px` and `70vh`.
- **Manual mode** (`panelHeight !== null`): the panel gets a fixed `height` via inline style. The textarea and preview pane fill available space via flex (`--fill` modifiers). Side buttons (`Md`, history, mic, Send) align to `flex-end`.
- **Auto mode** (`panelHeight === null`): default behavior — textarea auto-expands with content via `scrollHeight` measurement on input.
- **Double-click**: resets to auto mode (`setPanelHeight(null)`) and recalculates textarea height.

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Boolean `isMarkdown` flag | Simple boolean, not a format enum | Only two modes needed; avoids over-engineering for hypothetical future formats |
| Reuse existing `ChatMarkdown` | No new rendering dependencies | `ChatMarkdown` (react-markdown + rehype/remark plugins) already handles all markdown features for assistant messages |
| Optimistic rendering | User message appears immediately in chat stream | Consistent with existing send behavior; rollback on error |
| Raw/rendered toggle on hover | Small `raw`/`md` button in top-right of user bubble | Non-intrusive — only appears when you hover over a markdown message. Lets users inspect the source without disrupting flow |
| Drag-to-resize panel | Global mouse tracking with clamped height | More precise than CSS `resize` property. Works across textarea and preview pane uniformly. Double-click escape hatch prevents users from getting stuck |
| Input mode is component-local state | Not persisted to store or backend | Mode preference is ephemeral — new sessions start in text mode. Avoids unnecessary complexity |
| Backend is format-agnostic | Just threads `isMarkdown` through to persistence | Backend doesn't parse, validate, or transform markdown. It's a client-side rendering concern stored as metadata |

## Feature & Task Specs

| Component | Spec | Description |
|-----------|------|-------------|
| Frontend task | [feature_dual_mode_input.md](../current_tasks/frontend/feature_dual_mode_input.md) | Full implementation: InputArea toggle, toolbar, preview, resize, ChatStream rendering |
