---
id: improvement-chat-ui-task-folding
type: task-spec
status: done
title: 'Improve Chat UI: Nest subagent tool calls into foldable groups'
covers:
- frontend/src/components/ChatStream/
- backend/app/agent/runner.py
tags:
- high
- improvement
---
# Improve Chat UI: Nest subagent tool calls into foldable groups

Subagent tool calls currently render flat in the event stream, making multi-agent
sessions hard to follow. When a subagent spawns and executes 10+ tool calls, they
appear at the same level as the parent conversation — the user can't tell which tools
belong to which agent.

This task wires up `parentToolUseId` end-to-end so tool calls nest visually under
their parent `SubagentBlock`, with fold/expand to keep the stream scannable.

## Context

- **Protocol spec** already defines `parentToolUseId` on `toolCallStart` and
  `subagentStart` events (`backend/app/rpc/README.md` lines 80-82)
- **Backend** does NOT yet emit `parentToolUseId` or `subagentStart`/`subagentEnd`
- **Frontend** has `SubagentBlock` component but renders children flat
- **CHAT_UI spec** marks tool nesting as `[Planned]`

## Plan

### Backend

1. **`runner.py`** — Track the active tool-use stack during event streaming.
   When a `toolCallStart` is inside a subagent execution, include `parentToolUseId`
   in the emitted payload. Emit `agent/subagentStart` and `agent/subagentEnd`
   notifications when the SDK spawns/completes a subagent (using the SDK's
   `SubagentStart`/`SubagentStop` hooks or equivalent lifecycle callbacks).

### Frontend

2. **`ChatStream.tsx`** — Extend the pre-pass to build a parent→children map
   keyed by `agentId`. Tool events with `parentToolUseId` matching a subagent's
   `parentToolUseId` get grouped as children. Skip those children in the top-level
   render loop; pass them into the `SubagentBlock` instead.

3. **`SubagentBlock.tsx`** — Add fold/expand toggle (collapsed by default when
   finished, expanded while running). Render children `ToolCallCard`s inside
   a collapsible container. Show a summary line when collapsed:
   `"▶ 8 tool calls (3 Read, 2 Edit, 2 Bash, 1 Grep)"`.

4. **`ToolCallCard.tsx`** — Accept optional `compact` prop for nested display
   (smaller font, reduced padding, no outer border). Behavior unchanged.

5. **`ChatStream.css`** — Add fold/expand transition (max-height + opacity),
   nested indentation (left border + padding), and compact card variant styles.

## Files to modify

- `backend/app/agent/runner.py` (emit parentToolUseId, subagent lifecycle events)
- `frontend/src/components/ChatStream/ChatStream.tsx` (pre-pass tree building, nested rendering)
- `frontend/src/components/ChatStream/SubagentBlock.tsx` (fold/expand, children rendering, summary)
- `frontend/src/components/ChatStream/ToolCallCard.tsx` (compact variant)
- `frontend/src/components/ChatStream/ChatStream.css` (folding animation, nesting styles)

## Definition of done

- [x] Existing and new tests pass verifying subagent nesting and fold/expand behavior
- [x] `toolCallStart` events inside a subagent include `parentToolUseId`
- [x] `subagentStart` / `subagentEnd` events are emitted by the backend
- [x] Tool calls render nested inside their parent SubagentBlock
- [x] SubagentBlock is collapsible with summary when folded
- [x] Flat (non-subagent) tool calls render unchanged

**Priority:** High
**Type:** Improvement
**Status:** Done
**Started:** 2026-03-08
**Completed:** 2026-03-08
**Spec references:** `frontend/ui-specs/CHAT_UI.md`, `backend/app/rpc/README.md`
