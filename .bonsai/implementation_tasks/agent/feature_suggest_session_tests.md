---
id: task-suggest-session-tests
type: task-spec
status: done
title: Write tests for SuggestSession backend and tool interceptors
depends-on:
- task-suggest-session-runner
implements:
- module-agent
- feature-suggest-session
covers:
- backend/tests/agent/test_tools.py
tags:
- high
- new-feature
- testing
---
# Write tests for SuggestSession backend and tool interceptors

> Parent: [Agent Module](../../backend/app/agent/README.md) | Implements: [SuggestSession Backend Spec](../../backend/app/agent/tools/SUGGEST_SESSION.md) | Priority: **High** | Created: 2026-03-13

## Context

The SuggestSession feature is fully implemented in `backend/app/agent/tools/suggest_session.py` — MCP tool registration, validation helpers, and interactive intercept flow — but has **zero test coverage**. The `permissions.py` routing via `INTERCEPTORS` is also untested, and `intercept_visualize` (auto-approve) has no test. Existing tests in `test_runner.py` only cover `AskUserQuestion` and generic tool `confirmAction` flows.

The tests should follow the established patterns in `test_runner.py`: use `_setup_capturing_client()` + `_make_tracker_and_task()` helpers for integration tests, and direct function calls for unit tests.

## Plan

1. Create `backend/tests/agent/test_tools.py` — new test file for the tools package
2. Write unit tests for `_validate_skill` (2 cases)
3. Write unit tests for `_validate_spec_ids` (4 cases)
4. Write unit tests for `intercept_suggest_session` (3 cases: approve, dismiss, validation failure)
5. Write unit test for `intercept_visualize` (1 case: auto-approve)
6. Write integration test for `INTERCEPTORS` routing via `can_use_tool` in `permissions.py` (2 cases: suffix match dispatches correctly)
7. Run full test suite, verify no regressions

## Files to modify

- `backend/tests/agent/test_tools.py` (new) — all new test cases

## Test Cases

### `_validate_skill` (unit tests, no mocking)

| Test | Description |
|------|-------------|
| `test_validate_skill_exists` | Create a temp dir with `skills/{name}/SKILL.md`, call `_validate_skill(name, dir)` → returns `None` |
| `test_validate_skill_missing` | Call with a skill that doesn't exist → returns `"Unknown skill: {name}"` |

### `_validate_spec_ids` (unit tests, temp registry)

| Test | Description |
|------|-------------|
| `test_validate_spec_ids_empty_list` | Pass empty list → returns `None` (short-circuit) |
| `test_validate_spec_ids_all_valid` | Write a registry with entries `["a", "b"]`, validate `["a", "b"]` → returns `None` |
| `test_validate_spec_ids_some_missing` | Registry has `["a"]`, validate `["a", "b"]` → returns `"Unknown specIds: b"` |
| `test_validate_spec_ids_registry_unavailable` | Pass non-existent registry path → returns error containing `"registry unavailable"` |

### `intercept_suggest_session` (async tests, mock tracker + notify)

| Test | Description |
|------|-------------|
| `test_intercept_approve_flow` | Mock Future to resolve with `{"behavior": "allow"}`. Verify: returns `PermissionResultAllow` with `updated_input` containing `approved: True`. Verify `notify` called with `"agent/suggestSession"` and correct params (`bonsaiSid`, `skill`, `specIds`, `name`, `reason`). |
| `test_intercept_dismiss_flow` | Mock Future to resolve with `{"behavior": "deny"}`. Verify: returns `PermissionResultAllow` (not Deny!) with `updated_input` containing `dismissed: True`. |
| `test_intercept_validation_failure_bad_skill` | Pass input with skill that doesn't exist. Verify: returns `PermissionResultAllow` with `error` in `updated_input`. No Future registered, no notification sent. |
| `test_intercept_validation_failure_bad_spec_id` | Pass input with valid skill but invalid specId. Verify: returns `PermissionResultAllow` with `error` in `updated_input`. No Future registered. |

### `intercept_visualize` (async test)

| Test | Description |
|------|-------------|
| `test_intercept_visualize_auto_approve` | Call `intercept_visualize({...}, tracker, notify, task, config)`. Verify: returns `PermissionResultAllow(behavior="allow")`. No Future, no notification. |

### `INTERCEPTORS` routing via `permissions.py` (async integration tests)

| Test | Description |
|------|-------------|
| `test_interceptor_suffix_match_suggest_session` | Call `can_use_tool("mcp__bonsai-proactive__SuggestSession", ...)` with a mock. Verify: `intercept_suggest_session` is invoked (suffix match on `"SuggestSession"`). |
| `test_interceptor_suffix_match_visualize` | Call `can_use_tool("mcp__bonsai-vis__bonsai_visualize", ...)` with a mock. Verify: `intercept_visualize` is invoked (suffix match on `"bonsai_visualize"`). |

### `_suggest_session` handler (unit tests)

| Test | Description |
|------|-------------|
| `test_handler_approved` | Call `_suggest_session({"approved": True, "name": "X"})` → content contains `"approved and created"` |
| `test_handler_dismissed` | Call `_suggest_session({"dismissed": True})` → content contains `"dismissed"` |
| `test_handler_error` | Call `_suggest_session({"error": "Unknown skill"})` → content contains `"Error: Unknown skill"` |

## Implementation Notes

- Use `pytest` with `tmp_path` fixture for validation tests (temp `SKILL.md` files, temp `registry.json`)
- Use `AsyncMock` for `tracker` and `notify` in intercept tests
- For intercept_suggest_session: mock `tracker.register_future()` to return an `asyncio.Future`, then set its result before awaiting
- Create a helper `_make_config(tmp_path)` that builds an `AppConfig` with real `tmp_path`-based directories
- For INTERCEPTORS routing tests: patch the intercept functions to verify dispatch, or just call `can_use_tool` and check the result
- Test file: `backend/tests/agent/test_tools.py`
- Run with: `uv run pytest backend/tests/agent/test_tools.py -v`

## Definition of done

- [ ] All 15 test cases pass
- [ ] Existing tests in `test_runner.py` still pass (no regression)
- [ ] `uv run pytest backend/tests/agent/ -v` — all green

**Priority:** High
**Started:** 2026-03-13
