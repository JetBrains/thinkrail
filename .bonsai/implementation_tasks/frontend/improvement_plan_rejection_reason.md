# Improve plan rejection: add reason text so agent can align

When a user rejects a plan via PlanApprovalCard, the agent receives only `"Plan rejected"` — a hardcoded string with no context about what's wrong. The agent then blindly retries or drifts further without alignment. Users need to explain **why** they're rejecting so the agent can revise meaningfully.

## Current flow (broken)

```
User clicks "Reject Plan"
  → Frontend sends: { behavior: "deny", message: "Plan rejected" }
  → Backend returns: PermissionResultDeny(message="Plan rejected")
  → Agent sees: "Plan rejected" — no idea what was wrong
  → Agent retries blindly or continues without alignment
```

## Desired flow

```
User clicks "Reject Plan"
  → Textarea appears for rejection reason
  → User types: "The approach is too complex, use a simpler method"
  → Frontend sends: { behavior: "deny", message: "Plan rejected: The approach is too complex, use a simpler method" }
  → Backend returns: PermissionResultDeny(message="Plan rejected: The approach is too complex...")
  → Agent sees specific feedback → revises plan accordingly
```

## Plan

### 1. PlanApprovalCard: add rejection reason textarea

In `PlanApprovalCard.tsx`:

- Add state: `const [rejecting, setRejecting] = useState(false)` and `const [reason, setReason] = useState("")`
- Change `onDeny` prop signature: `onDeny: (reason?: string) => void`
- When user clicks "Reject Plan": set `rejecting = true` to reveal a textarea + "Submit Rejection" button
- On submit: call `onDeny(reason)` with the user's text
- Allow empty reason (falls back to generic "Plan rejected")
- Show a "Cancel" link to go back to the approve/reject buttons

**Pending state UX:**
```
[Plan content markdown...]

[Approve Plan]  [Reject Plan]       ← initial state

[Plan content markdown...]

Why are you rejecting this plan?     ← after clicking "Reject Plan"
┌─────────────────────────────────┐
│ (textarea, 2-3 rows)            │
└─────────────────────────────────┘
[Submit Rejection]  [Cancel]
```

**Answered (denied) state:** Show the rejection reason in the compact expanded view if one was provided.

### 2. ChatStream: pass reason in deny message

In `ChatStream.tsx`, update the `onDeny` handler:

```tsx
onDeny={(reason?: string) =>
  onResolveRequest(requestId, {
    behavior: "deny",
    message: reason
      ? `Plan rejected: ${reason}`
      : "Plan rejected",
    interrupt: false,
  })
}
```

### 3. Backend: already works (no changes needed)

`permissions.py` already passes the `message` field through to `PermissionResultDeny`:

```python
return PermissionResultDeny(
    behavior="deny",
    message=response.get("message", "Denied by user"),  # ← already dynamic
    interrupt=response.get("interrupt", False),
)
```

The SDK delivers this `message` back to the agent as the tool result for the denied `ExitPlanMode` call. **No backend changes required.**

### 4. CSS: style the rejection textarea

In `ChatStream.css`, add styles for the rejection reason UI:

- `.chat-plan-approval-reason` — container for textarea + buttons
- `.chat-plan-approval-reason textarea` — styled textarea (matches existing card theme)
- Transition/animation for the reveal

## Files to modify

- `frontend/src/components/ChatStream/PlanApprovalCard.tsx` — Add rejection reason textarea + state management
- `frontend/src/components/ChatStream/ChatStream.tsx` — Pass reason string in deny message
- `frontend/src/components/ChatStream/ChatStream.css` — Styles for rejection reason UI

## Definition of done

- [ ] Clicking "Reject Plan" reveals a textarea for the rejection reason
- [ ] Submitting with a reason sends `"Plan rejected: {reason}"` in the deny message
- [ ] Submitting without a reason sends `"Plan rejected"` (backwards compatible)
- [ ] The deny message reaches the agent via `PermissionResultDeny.message`
- [ ] Manual verification: reject a plan with a reason, confirm the agent addresses the feedback

**Priority:** High
**Depends on:** `improvement_plan_approval_card`, `bugfix_plan_approval_content`
**Started:** 2026-03-12
