# Improve ExitPlanMode display: PlanApprovalCard

> Replace raw JSON "Action requires approval" card with a dedicated plan review UI

**Status:** Active
**Priority:** Medium
**Depends on:** `feature_chat_ui`
**Spec references:**
- `frontend/ui-specs/CHAT_UI.md` — PlanApprovalCard component section
- `backend/app/agent/README.md` — ExitPlanMode plan content enrichment section
- `backend/app/rpc/README.md` — enriched confirmAction payload

## Summary

When the agent calls `ExitPlanMode`, the current UI renders a generic `ApprovalCard` showing "Action requires approval" with a raw JSON blob of the `allowedPrompts` array. This is unusable — the user can't see what plan they're approving.

This task implements a dedicated `PlanApprovalCard` component that:
1. Displays the plan content as rendered markdown (collapsible, resizable)
2. Shows requested Bash permissions as compact purple tag chips
3. Provides "Approve Plan" / "Reject Plan" buttons with clear semantics
4. Collapses to a compact row after the user responds (plan title + status badge)

The backend is also updated to enrich the `agent/confirmAction` event with the plan text.

## Plan

### Backend: runner.py enrichment

1. Add `_current_turn_text: list[str]` buffer inside the conversation loop scope
2. Append each `TextBlock.text` from `AssistantMessage` events to the buffer
3. Clear the buffer at the start of each `client.query()` call
4. In `can_use_tool`, when `tool_name == "ExitPlanMode"`:
   - Join `_current_turn_text` into a single string
   - Inject `"planContent": joined_text` into a copy of `input_data`
   - Send the enriched `toolInput` in the `agent/confirmAction` notification
5. All other tools continue to use `input_data` as-is

### Frontend: PlanApprovalCard component

6. Create `PlanApprovalCard.tsx` in `frontend/src/components/ChatStream/`:
   - Props: `planContent?: string`, `allowedPrompts?: AllowedPrompt[]`, `answered`, `decision`, `onApprove`, `onDeny`
   - **Not answered (full card):**
     - Header: "PLAN READY FOR REVIEW" (9px uppercase, purple)
     - Body: `<ChatMarkdown>` rendering of `planContent` (max-height 400px, overflow-y auto, resize vertical, min-height 60px)
     - Permissions: compact tag chips for each `allowedPrompt.prompt` (only if non-empty)
     - Actions: "Approve Plan" (green) / "Reject Plan" (red outline)
   - **Answered (compact mode):**
     - Single clickable row: label + plan title (extracted from first heading or first line) + status badge
     - Click to expand: full plan body + permission tags
     - State modifiers: `.chat-plan-approval--approved` / `--denied`
   - Helper: `extractPlanTitle(planContent)` — regex `^#+\s+(.+)` → first heading, else first line, fallback "Plan"

### Frontend: ChatStream wiring

7. In `ChatStream.tsx`:
   - Import `PlanApprovalCard`
   - In the `confirmAction` case, add: `if (p.toolName === "ExitPlanMode")` → render `<PlanApprovalCard>` instead of `<ApprovalCard>`
   - Pass `toolInput.planContent` and `toolInput.allowedPrompts` as props

### Frontend: SessionPanel placeholder

8. In `SessionPanel.tsx` (or wherever placeholder text is computed):
   - When `pendingRequest.type === "approval"` and `pendingRequest.toolName === "ExitPlanMode"`: use `"Review the plan above..."` instead of `"Waiting for your approval above..."`

### Frontend: CSS

9. In `ChatStream.css`, add all `.chat-plan-approval-*` classes per the CHAT_UI.md spec:
   - Root: `border: 2px solid var(--purple)`, `max-width: 90%`, `bg: var(--elevated)`, `slideUp`
   - Answered: `opacity: 0.7`
   - Approved/denied modifiers: green/red border
   - Header: 9px uppercase purple
   - Body: bordered markdown area with resize
   - Tags: purple chips with `rgba(187,154,247,0.1)` background
   - Compact row: flex with truncated title
   - Actions: flex row with button gap

## Files to modify

- `backend/app/agent/runner.py` — Add `_current_turn_text` buffer, enrich ExitPlanMode in `can_use_tool`
- `frontend/src/components/ChatStream/PlanApprovalCard.tsx` — **NEW** — dedicated plan approval component
- `frontend/src/components/ChatStream/ChatStream.tsx` — Import PlanApprovalCard, route ExitPlanMode
- `frontend/src/components/ChatStream/ChatStream.css` — Add `.chat-plan-approval-*` styles
- `frontend/src/components/ChatStream/SessionPanel.tsx` — Update placeholder text for plan approvals

## Definition of done

- [ ] ExitPlanMode displays plan content as rendered markdown (not raw JSON)
- [ ] `allowedPrompts` appear as compact purple tag chips
- [ ] "Approve Plan" / "Reject Plan" buttons work and send correct `behavior` response
- [ ] Compact answered state shows extracted plan title + approval/rejection badge
- [ ] Backend accumulates turn text and injects `planContent` into confirmAction payload
- [ ] Implementation matches `CHAT_UI.md` PlanApprovalCard spec exactly
- [ ] Unit tests for PlanApprovalCard rendering (pending, answered-approved, answered-denied states)
- [ ] Unit test for `extractPlanTitle()` helper
- [ ] Manual verification: trigger ExitPlanMode in a plan-mode session and verify the full flow

**Started:** 2026-03-12
