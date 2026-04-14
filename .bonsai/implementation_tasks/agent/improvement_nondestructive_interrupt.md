# Replace destructive interrupt with SDK native `client.interrupt()`

Replace the current `bg.cancel()` + re-launch interrupt mechanism with the Claude Agent SDK's built-in `client.interrupt()`. This preserves the SDK client, conversation context, and runner loop — the user can continue the same session after interrupting without losing anything.

## Context

Currently `service.py:interrupt_task()` cancels the entire asyncio background task (`bg.cancel()`), which:
1. Raises `CancelledError` in `runner.py`
2. Triggers `async with ClaudeSDKClient` context manager exit → `client.disconnect()` → CLI subprocess terminated
3. Destroys all conversation context
4. Re-launches `_run_background()` with a brand new SDK client and freshly built system prompt

The Claude Agent SDK already exposes `ClaudeSDKClient.interrupt()` (client.py:221) which sends a `{"subtype": "interrupt"}` control request to the CLI subprocess. The CLI gracefully stops the current generation and the `receive_response()` generator yields a final `ResultMessage` — all without destroying the client or session.

**Spec:** [Agent Module README — Interrupt Flow](../../backend/app/agent/README.md#interrupt-flow)

## Plan

### 1. Add interrupt primitives to `tracker.py`

**File:** `backend/app/agent/tracker.py`

Add a per-session interrupt flag and a non-destructive future resolution method:

```python
class Tracker:
    def __init__(self) -> None:
        # ... existing fields ...
        self._interrupted: set[str] = set()  # bonsai_sids with pending interrupt

    def set_interrupted(self, bonsai_sid: str) -> None:
        """Mark session as interrupted (service sets before calling client.interrupt)."""
        self._interrupted.add(bonsai_sid)

    def is_interrupted(self, bonsai_sid: str) -> bool:
        """Check if session has a pending interrupt flag."""
        return bonsai_sid in self._interrupted

    def clear_interrupted(self, bonsai_sid: str) -> None:
        """Clear interrupt flag (runner calls after processing)."""
        self._interrupted.discard(bonsai_sid)

    def interrupt_futures(self, bonsai_sid: str) -> None:
        """Resolve pending futures with deny+interrupt instead of cancelling.

        Unlike cancel_futures() which raises CancelledError, this produces a
        clean PermissionResultDeny(interrupt=True) through the SDK's intended
        mechanism.
        """
        task_futures = self._futures.pop(bonsai_sid, {})
        for future in task_futures.values():
            if not future.done():
                future.set_result({
                    "behavior": "deny",
                    "message": "Interrupted",
                    "interrupt": True,
                })
```

Also clean up `_interrupted` in `remove_task()`:
```python
def remove_task(self, bonsai_sid: str) -> None:
    self._tasks.pop(bonsai_sid, None)
    self._queues.pop(bonsai_sid, None)
    self._futures.pop(bonsai_sid, None)
    self._clients.pop(bonsai_sid, None)
    self._interrupted.discard(bonsai_sid)  # NEW
```

### 2. Rewrite `interrupt_task()` in service.py

**File:** `backend/app/agent/service.py`

Replace the entire `interrupt_task` method (lines 76-108). New logic:

```python
async def interrupt_task(self, bonsai_sid: str) -> None:
    """Cancel the current turn non-destructively. Session stays alive (idle)."""
    task = self._tracker.get_task(bonsai_sid)
    if task.status not in ("running", "waiting"):
        return

    # 1. Set interrupt flag BEFORE calling client.interrupt()
    #    so runner knows to emit agent/interrupted instead of turnComplete
    self._tracker.set_interrupted(bonsai_sid)

    # 2. Resolve pending futures with deny+interrupt (for waiting state)
    self._tracker.interrupt_futures(bonsai_sid)

    # 3. Interrupt the SDK turn (for running state)
    client = self._tracker.get_client(bonsai_sid)
    if client:
        try:
            await client.interrupt()
        except Exception:
            pass  # Client may already be disconnected

    # Note: NO bg.cancel(), NO re-launch.
    # The runner's receive_response() loop will get a ResultMessage,
    # check is_interrupted(), emit agent/interrupted, and return to idle.
```

**Delete:** The entire re-launch block:
- `bg = self._running_tasks.pop(...)` / `bg.cancel()` / `await bg`
- `spec_context = self._build_context_for(task)`
- `new_bg = asyncio.create_task(self._run_background(...))`

### 3. Update `runner.py` to check interrupt flag on ResultMessage

**File:** `backend/app/agent/runner.py`

In the `receive_response()` loop, update the `ResultMessage` handling (around line 195):

```python
elif isinstance(sdk_event, ResultMessage):
    turn_cost = sdk_event.total_cost_usd or 0.0
    turn_turns = sdk_event.num_turns
    total_cost += turn_cost
    total_turns += turn_turns
    duration_ms = int((time.monotonic() - start_time) * 1000)

    # Check if this ResultMessage came from an interrupt
    interrupted = tracker.is_interrupted(task.bonsai_sid)
    if interrupted:
        tracker.clear_interrupted(task.bonsai_sid)

    if sdk_event.is_error and not interrupted:
        # Error path (unchanged)
        await notify("agent/error", {
            "bonsaiSid": task.bonsai_sid,
            "sessionId": sdk_event.session_id or session_id,
            "subtype": "turn_error",
            "errors": [sdk_event.result] if sdk_event.result else [],
            "result": sdk_event.result or "",
            "costUsd": total_cost,
            "turns": total_turns,
            "durationMs": duration_ms,
            "usage": sdk_event.usage or {},
        })
    elif interrupted:
        # Interrupt path — emit interrupted, not turnComplete
        await notify("agent/interrupted", {
            "bonsaiSid": task.bonsai_sid,
            "sessionId": sdk_event.session_id or session_id,
            "costUsd": total_cost,
            "turns": total_turns,
            "durationMs": duration_ms,
            "usage": sdk_event.usage or {},
        })
    else:
        # Normal turn complete (unchanged)
        await notify("agent/turnComplete", {
            "bonsaiSid": task.bonsai_sid,
            "sessionId": sdk_event.session_id or session_id,
            "result": sdk_event.result or "",
            "costUsd": turn_cost,
            "turns": turn_turns,
            "durationMs": duration_ms,
            "usage": sdk_event.usage or {},
        })

    tracker.set_status(task.bonsai_sid, "idle")
    break  # back to conversation loop, same client
```

### 4. Remove `_run_background` CancelledError handling for interrupt

**File:** `backend/app/agent/service.py`

In `_run_background()` (line 340), the `except asyncio.CancelledError: pass` block was solely for the interrupt path. With the new design, `CancelledError` should no longer occur during normal interrupt flow. Keep it as a safety net but add a log:

```python
except asyncio.CancelledError:
    # Should no longer happen during interrupt (uses client.interrupt() now).
    # Keep as safety net for unexpected cancellation.
    logger.warning("Runner for %s received unexpected CancelledError", task.bonsai_sid)
```

### 5. Add tests

**File:** `backend/tests/agent/test_tracker.py`

New tests:
- `test_interrupt_flag_lifecycle` — set_interrupted → is_interrupted returns True → clear_interrupted → returns False
- `test_interrupt_futures_resolves_with_deny` — register futures, call interrupt_futures, verify resolved with `{"behavior": "deny", "interrupt": True}` (not cancelled)
- `test_interrupt_futures_empty_is_noop` — call interrupt_futures on session with no futures, no error
- `test_remove_task_clears_interrupted` — set_interrupted, remove_task, is_interrupted returns False

**File:** `backend/tests/agent/test_runner.py`

New tests:
- `test_interrupt_emits_interrupted_not_turn_complete` — set tracker interrupt flag, feed a ResultMessage, verify `agent/interrupted` notification (not `agent/turnComplete`)
- `test_normal_result_emits_turn_complete` — no interrupt flag, feed ResultMessage, verify `agent/turnComplete`
- `test_interrupted_result_returns_to_idle` — after interrupt ResultMessage, runner goes back to waiting for next message (conversation loop continues)

**File:** `backend/tests/agent/test_service.py`

New/updated tests:
- `test_interrupt_calls_client_interrupt` — mock tracker.get_client() to return a mock client, call interrupt_task(), verify `client.interrupt()` was called
- `test_interrupt_sets_flag_before_client_interrupt` — verify `set_interrupted()` is called before `client.interrupt()`
- `test_interrupt_resolves_futures_with_deny` — verify `interrupt_futures()` called (not `cancel_futures()`)
- `test_interrupt_no_relaunch` — after interrupt_task(), verify no new task in `_running_tasks` (runner stays the same)
- `test_interrupt_idle_is_noop` — session in idle state, interrupt_task() returns immediately

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/tracker.py` | Add `_interrupted` set, `set_interrupted()`, `is_interrupted()`, `clear_interrupted()`, `interrupt_futures()`, update `remove_task()` |
| `backend/app/agent/service.py` | Rewrite `interrupt_task()` — use `client.interrupt()`, remove bg.cancel/re-launch. Add warning log to CancelledError handler. |
| `backend/app/agent/runner.py` | Update ResultMessage handling — check `tracker.is_interrupted()`, emit `agent/interrupted` vs `agent/turnComplete` |
| `backend/tests/agent/test_tracker.py` | Add tests for interrupt flag lifecycle and `interrupt_futures()` |
| `backend/tests/agent/test_runner.py` | Add tests for interrupt-aware ResultMessage handling |
| `backend/tests/agent/test_service.py` | Add tests for non-destructive interrupt flow |

## Definition of done

- All new tests pass (`cd backend && uv run pytest tests/agent/`)
- Existing tests still pass (`cd backend && uv run pytest`)
- `interrupt_task()` calls `client.interrupt()` — NOT `bg.cancel()`
- No re-launch code in interrupt path (no `asyncio.create_task(_run_background(...))` after interrupt)
- Runner emits `agent/interrupted` (not `agent/turnComplete`) when interrupt flag is set
- Runner stays alive after interrupt — same client, same conversation loop

**Priority:** High
**Type:** Improvement
**Module:** agent
**Started:** 2026-03-08
