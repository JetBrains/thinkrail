---
id: bugfix-plan-approval-content
type: task-spec
status: done
title: 'Fix PlanApprovalCard: shows random assistant text instead of actual plan'
depends-on:
- improvement-plan-approval-card
implements:
- chat-ui
- module-agent
covers:
- backend/app/agent/permissions.py
- frontend/src/components/ChatStream/ChatStream.tsx
- frontend/ui-specs/CHAT_UI.md
tags:
- high
- bug-fix
---
# Fix PlanApprovalCard: shows random assistant text instead of actual plan

The `PlanApprovalCard` was displaying wrong content when the agent called `ExitPlanMode`. Instead of showing the actual plan, it showed accumulated assistant text from the entire turn — exploration notes, reasoning, tool descriptions, etc.

## Root cause

The SDK's `ExitPlanMode` tool call natively includes two fields in `input_data`:
- `plan` — The clean plan markdown (the actual plan content written to a file)
- `planContent` — Accumulated turn text (noisy exploration/reasoning text)

The frontend was reading `toolInput.planContent` (the noisy field) instead of `toolInput.plan` (the clean plan). Meanwhile, the backend had unnecessary enrichment code in `permissions.py` that tried to override `planContent` with `tracker.get_turn_text()` — which was the same noisy data.

## Fix applied (SDK-native approach)

### 1. Backend: Remove enrichment from permissions.py

The `ExitPlanMode` special case in `can_use_tool()` was removed. The SDK's `input_data` is passed through as-is — no backend enrichment needed since the SDK already provides the plan content natively.

### 2. Backend: Remove Write content tracking from tracker.py

The `_last_write_content` buffer, `set_last_write_content()`, and `get_last_write_content()` methods that were added as part of an earlier (incorrect) fix attempt were removed.

### 3. Backend: Remove Write content capture from runner.py

The `tracker.set_last_write_content()` call that was added to capture Write tool content was removed — unnecessary with the SDK-native approach.

### 4. Frontend: Read `toolInput.plan` instead of `toolInput.planContent`

In `ChatStream.tsx`, changed the prop extraction:
```tsx
// Before:
planContent={(toolInput?.planContent as string) ?? undefined}
// After:
planContent={(toolInput?.plan as string) ?? undefined}
```

### 5. Spec updates

Updated `CHAT_UI.md` dispatch table to document that `confirmAction` with `ExitPlanMode` routes to `<PlanApprovalCard>`, and that `planContent` prop comes from the SDK's native `toolInput.plan` field.

## Files modified

- `backend/app/agent/permissions.py` — Removed ExitPlanMode enrichment block
- `backend/app/agent/tracker.py` — Removed `_last_write_content` tracking
- `backend/app/agent/runner.py` — Removed `set_last_write_content()` call
- `frontend/src/components/ChatStream/ChatStream.tsx` — Changed `toolInput.planContent` → `toolInput.plan`
- `frontend/ui-specs/CHAT_UI.md` — Documented SDK-native plan field and PlanApprovalCard routing

## Definition of done

- [x] PlanApprovalCard shows the actual plan content from SDK's `plan` field
- [x] No unnecessary backend enrichment — SDK data passed through as-is
- [x] Empty-state fallback in PlanApprovalCard when no content is available
- [x] All 56 existing tests pass
- [x] CHAT_UI spec updated to document PlanApprovalCard routing and data source

**Priority:** High
**Depends on:** `improvement_plan_approval_card`
**Status:** Complete
**Started:** 2026-03-12
**Completed:** 2026-03-12
