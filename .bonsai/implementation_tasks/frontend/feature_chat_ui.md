---
id: task-fe-chat-ui
type: task-spec
status: done
title: Implement Chat UI
depends-on:
- task-fe-app-shell
implements:
- chat-ui
covers:
- frontend/src/components/ChatStream/
tags:
- high
- new-feature
- frontend
---
# Implement Chat UI

> Agent event stream rendering with tool cards, questions, and streaming text

**Status:** Done
**Priority:** High
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/CHAT_UI.md`

## Summary

The Chat UI is the center panel's primary content. It renders a scrolling stream of visual elements derived from JSON-RPC agent event notifications. Each of the 13 event types maps to a distinct React component with specific rendering, interaction, and state transition rules.

## Files to Create

- `frontend/src/components/ChatStream/ChatStream.tsx` — scrolling event list with auto-scroll behavior
- `frontend/src/components/ChatStream/AssistantMessage.tsx` — streamed markdown text with syntax highlighting
- `frontend/src/components/ChatStream/ToolCallCard.tsx` — collapsible card: tool name + input → output/error. Status: running (spinner) → success (green) / error (red)
- `frontend/src/components/ChatStream/SubagentBlock.tsx` — nested indented section with spinner, collapsed summary on end
- `frontend/src/components/ChatStream/QuestionCard.tsx` — interactive question with option buttons (single/multi select). Sends `agent/respond` on click.
- `frontend/src/components/ChatStream/ApprovalCard.tsx` — tool approval with Approve/Deny buttons. Sends `agent/respond` on click.
- `frontend/src/components/ChatStream/CompletionBanner.tsx` — session-complete metrics: cost, duration, turns
- `frontend/src/components/ChatStream/ErrorBanner.tsx` — red error display with details
- `frontend/src/components/ChatStream/CompactMarker.tsx` — context compacted boundary marker
- `frontend/src/components/ChatStream/SessionStatusLine.tsx` — model, cost, tool calls, context bar between chat and input
- `frontend/src/components/ChatStream/InputArea.tsx` — auto-resizing textarea, Mod+Enter to send
- `frontend/src/components/ChatStream/SessionTabBar.tsx` — tab per session with status dots, background alert badges, close button

## Key Implementation Details

### Event-to-Component Mapping
| Event | Component | Key Behavior |
|-------|-----------|-------------|
| `agent/textDelta` | AssistantMessage | Streaming text with blinking cursor |
| `agent/toolCallStart` → `toolCallEnd` | ToolCallCard | Animated running → result transition |
| `agent/askUserQuestion` | QuestionCard | Interactive, sends response |
| `agent/confirmAction` | ApprovalCard | Interactive, sends response |
| `agent/done` | CompletionBanner | Terminal, shows metrics |

### Auto-Scroll
Scroll follows latest event. If user scrolls up, auto-scroll pauses. Resume button appears. Resumes on new user message.

### Tool Icons
Read: 📖, Write: ✏️, Edit: ✏️, Bash: ▶, Grep: 🔍, Glob: 📁, Agent: ⚡, WebFetch: 🌐, WebSearch: 🔍

## Definition of Done

- [ ] All 13 agent event types render as distinct components
- [ ] Streaming text displays character-by-character with cursor
- [ ] Tool call cards show running state → result transition
- [ ] Question and approval cards are interactive and send `agent/respond`
- [ ] Auto-scroll works with pause-on-scroll-up behavior
- [ ] Session tabs show status dots and background alert badges
- [ ] Input area sends messages via Mod+Enter
- [ ] Session status line shows live metrics (model, cost, context)
