# Fix subagent attention cards not rendering in chat

When a subagent triggers an action that requires user attention — tool approval
(`confirmAction`) or a question (`askUserQuestion`) — the chat UI fails to
display the interactive card. The user sees only a notification that attention is
needed, and the agent stalls because it never receives a response.

## Root cause

`ChatStream.tsx` pre-scan (lines 82-100) groups **all** events occurring between
`subagentStart` and `subagentEnd` into the `childIndices` set. These events are
then skipped in the main render loop (line 106: `if (childIndices.has(i)) return null`).

The events are passed to `SubagentBlock` as `childEvents`, but `SubagentBlock`
only renders two event types:
- `toolCallStart` → `ToolCallCard`
- `textDelta` → inline text

Everything else — including `askUserQuestion` and `confirmAction` — hits the
`return null` fallback and is silently dropped.

**Result**: Interactive approval/question cards are swallowed. The backend
`can_use_tool()` future awaits a response that never arrives.

## Plan

1. In `ChatStream.tsx`, modify the pre-scan child-grouping loop to **exclude**
   `askUserQuestion` and `confirmAction` events from being added to
   `childIndices`. These event types should always render at the top level
   regardless of subagent nesting depth.

   ```typescript
   // In the pre-scan loop, change:
   } else if (stack.length > 0) {
     const [parentIdx] = stack[stack.length - 1];
     subagentChildren.get(parentIdx)!.push(i);
     childIndices.add(i);
   }

   // To:
   } else if (stack.length > 0) {
     const attentionEvents = new Set(["askUserQuestion", "confirmAction"]);
     if (!attentionEvents.has(ev.eventType)) {
       const [parentIdx] = stack[stack.length - 1];
       subagentChildren.get(parentIdx)!.push(i);
       childIndices.add(i);
     }
   }
   ```

2. Verify that the existing `askUserQuestion` and `confirmAction` cases in the
   main switch statement (lines 172-213) handle these events correctly — they
   already do, including `answeredRequests` tracking and `onResolveRequest`
   callbacks.

## Files to modify

- `frontend/src/components/ChatStream/ChatStream.tsx` — exclude attention events
  from subagent child grouping in pre-scan loop

## Definition of done

- Manual verification: run a session where a subagent triggers a tool approval
  or question; confirm the ApprovalCard / QuestionCard renders at the top level
  and can be interacted with (approve/deny/answer)
- Agent resumes after the user responds — no more stuck state

**Priority:** Critical
**Started:** 2026-03-09
**Status:** Done
