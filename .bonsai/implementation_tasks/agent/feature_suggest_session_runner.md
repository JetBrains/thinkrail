---
id: task-suggest-session-runner
type: task-spec
status: done
title: Implement SuggestSession branch in runner.py can_use_tool
implements:
- module-agent
- feature-suggest-session
covers:
- backend/app/agent/tools/suggest_session.py
- backend/app/agent/tools/__init__.py
- backend/app/agent/permissions.py
tags:
- high
- new-feature
---
# Implement SuggestSession branch in runner.py can_use_tool

> Parent: [Agent Module](../../backend/app/agent/README.md) | Implements: [SuggestSession Backend Spec](../../backend/app/agent/tools/SUGGEST_SESSION.md) | Priority: **High** | Created: 2026-03-08

## Context

SuggestSession is an interactive proactive tool that lets the agent suggest follow-up sessions to the developer. It follows the exact same `canUseTool` interception pattern already established by `AskUserQuestion` — create an `asyncio.Future`, send a server-initiated JSON-RPC request to the frontend, await the developer's response, and return `PermissionResultAllow`.

The backend change is scoped entirely to `runner.py` — no changes needed in `service.py`, `tracker.py`, `notifications.py`, or `persistence.py` since they already support the Future/request pattern.

## Plan

1. Add `SuggestSession` branch to `can_use_tool` in `runner.py`, between the existing `AskUserQuestion` and generic `confirmAction` branches:
   ```python
   elif tool_name == "SuggestSession":
       request_id = str(uuid4())
       future = tracker.register_future(task.bonsai_sid, request_id)
       await notify(
           "agent/suggestSession",
           {
               "bonsaiSid": task.bonsai_sid,
               "skill": input_data.get("skill", ""),
               "specIds": input_data.get("specIds", []),
               "name": input_data.get("name", ""),
               "reason": input_data.get("reason", ""),
           },
           request_id=request_id,
       )
       response = await future
       if response.get("behavior") == "deny":
           return PermissionResultAllow(
               behavior="allow",
               updated_input={**input_data, "dismissed": True},
           )
       return PermissionResultAllow(
           behavior="allow",
           updated_input={**input_data, "approved": True},
       )
   ```

2. Write unit tests in `tests/test_agent/test_runner.py`:
   - Test that `SuggestSession` tool call sends `agent/suggestSession` request with correct params
   - Test approve flow: response `{"behavior": "allow"}` → returns `PermissionResultAllow` with `approved: True`
   - Test dismiss flow: response `{"behavior": "deny"}` → returns `PermissionResultAllow` (NOT Deny) with `dismissed: True`
   - Test that `request_id` is passed to both `tracker.register_future` and `notify`

## Files to modify

- `backend/app/agent/runner.py` — add `elif tool_name == "SuggestSession"` branch in `can_use_tool` (~20 lines)
- `backend/tests/test_agent/test_runner.py` — add test cases for SuggestSession interception

## Design notes

- **Both approve AND dismiss return `PermissionResultAllow`** — never `PermissionResultDeny`. Deny triggers SDK error handling, which is not the desired behavior for a dismissed suggestion. The outcome is signaled via `updated_input` keys: `approved: True` or `dismissed: True`.
- Pattern is identical to `AskUserQuestion` (lines 48-76 in current `runner.py`) with different method name, params, and response handling.
- No validation of `skill` or `specIds` on the backend — the frontend handles session creation and will fail gracefully if params are invalid.

## Definition of done

- [ ] `SuggestSession` branch added to `can_use_tool` in `runner.py`
- [ ] Unit tests pass for approve flow, dismiss flow, and correct param forwarding
- [ ] Existing `AskUserQuestion` and `confirmAction` tests still pass (no regression)
