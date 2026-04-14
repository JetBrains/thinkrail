# Rewrite runner.py for conversational session loop

> Core change: single query → persistent conversation loop

**Status:** Done
**Priority:** High
**Started:** 2026-03-02
**Depends on:** `task-session-models-tracker`
**Spec reference:** `backend/app/agent/README.md` — Session Lifecycle, Conversation Loop

## Files to Modify

- `backend/app/agent/runner.py`

## Summary

Rewrite `runner.py` to support persistent conversational sessions. The current implementation does a single `client.query()` and exits. The new implementation keeps the SDK client open and loops: wait for user message → query SDK → stream events → emit `turnComplete` → wait for next message. The initial `askUserQuestion` prompt hack is removed entirely.

## Changes

### Remove
- Lines 92-116: the `askUserQuestion` hack that collects the initial prompt
- The `run()` function's assumption that a single `ResultMessage` means "done"

### Rewrite conversation loop

```
async with ClaudeSDKClient(options) as client:
    # 1. Wait for SystemMessage(init) → emit agent/sessionStart
    # 2. Set state to idle

    while True:
        message = await tracker.get_next_message(task.id)

        if message is END_SIGNAL:
            break  # agent/end was called → exit loop

        # Set state to running
        await client.query(message)

        async for sdk_event in client.receive_response():
            # Same event mapping as current code
            # On ResultMessage:
            #   → emit agent/turnComplete (not agent/done)
            #   → set state to idle
            #   → break inner loop (go back to waiting)

    # Session closed → emit agent/done
```

### Event mapping changes

| Current | New |
|---------|-----|
| `ResultMessage` → `agent/done` or `agent/error` | Non-error `ResultMessage` → `agent/turnComplete`; session stays open |
| N/A | Session close (END_SIGNAL) → `agent/done` |
| N/A | Cancellation during turn → `agent/interrupted` |

### Return value

`run()` should return an `AgentResult` summarizing the full session (aggregate cost, total turns, total duration), not just a single turn.

## Plan

1. Remove the initial `askUserQuestion` prompt collection (lines 92-116)
2. Restructure `run()` with outer conversation loop
3. Move SDK client creation to top of function, keep open for full session
4. Inner loop: process SDK events as before
5. On `ResultMessage`: emit `agent/turnComplete`, break inner loop
6. On `END_SIGNAL`: break outer loop, emit `agent/done`
7. Handle cancellation: catch `asyncio.CancelledError` in inner loop, emit `agent/interrupted`
8. Accumulate session-level stats (total cost, total turns, total duration)
9. Update existing tests
10. Write new tests for multi-turn flow, interruption, end signal

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/agent/runner.py` | Rewrite | Conversation loop, remove prompt hack |
| `backend/tests/agent/test_runner.py` | Update | Multi-turn tests, interrupt, end |

## Definition of Done

- All unit tests pass
- Runner loops over multiple user messages within a single SDK session
- `agent/turnComplete` emitted after each turn (not `agent/done`)
- `agent/done` emitted only when session closes
- `agent/interrupted` emitted when turn is cancelled
- No `askUserQuestion` hack for initial prompt
