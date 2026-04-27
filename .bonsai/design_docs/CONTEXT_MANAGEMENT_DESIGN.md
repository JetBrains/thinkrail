---
id: context-management-design
type: architecture-design
status: active
title: 'Context Management: Prevent & Recover from "Prompt is too long" Errors'
parent: design-doc
tags:
- context-window
- error-recovery
---
# Context Management: Prevent & Recover from "Prompt is too long" Errors

## Context

The Bonsai agent system has no context window management. When the system prompt (with large specs) or accumulated conversation history exceeds the model's context window, the Anthropic API returns "Prompt is too long". This surfaces as a cryptic "Session error: turn error: Prompt is too long" toast with no recovery options.

The Claude Agent SDK has built-in auto-compaction (`PreCompact` hook), and the frontend already has a `CompactMarker` component and `agent/compact` event handling — but the backend runner never wires the hook or emits the event.

Additionally, `_get_context_max()` defaults to 200K when the model registry isn't available, causing incorrect context metrics even for 1M-context models.

### Hard Limits Analysis

| Layer | Limit | Value | Causes "Prompt is too long"? |
|-------|-------|-------|------------------------------|
| **API** | Context window (Opus/Sonnet 4.6) | 1,000,000 tokens | **YES — the primary cause** |
| **API** | Context window (Haiku/legacy) | 200,000 tokens | **YES** |
| **API** | Max output per request | 64K–128K tokens | No (different error) |
| **API** | Per-message size limit | **None** | N/A — only total context matters |
| **API** | Rate limits (ITPM) | Tier-dependent | No (produces 429 error) |
| **SDK** | `max_turns` per `query()` | 50 (Bonsai default) | Indirectly — more turns = more context |
| **SDK** | `max_buffer_size` (CLI stdout) | 10MB (Bonsai override) | Edge case — very large tool outputs |
| **SDK** | Internal message stream buffer | 100 messages | No (internal backpressure) |
| **Bonsai** | Message size validation | **None** | **Gap — no validation at any layer** |
| **Bonsai** | System prompt size validation | **None** | **Gap — no pre-start check** |
| **Bonsai** | Context window management | **None** | **Gap — SDK compaction not wired** |

**The context window is the ONLY hard limit producing "Prompt is too long".** Everything (system prompt + all messages + all tool results) must fit within it. There is NO per-message or per-turn limit from the API — just the total window.

**No message or turn size limits exist anywhere in the Bonsai stack.** A user can paste an arbitrarily large message — it flows untouched through:
- Frontend InputArea (no `maxLength`)
- WebSocket RPC (no payload size check)
- `send_message` RPC handler (no validation)
- `service.send_message()` (validates status only)
- `tracker.enqueue_message()` (raw queue put)
- SDK `client.query()` (writes JSON to CLI stdin, no size check)

A single oversized message can trigger "Prompt is too long" even if context usage is low.

## Architecture: Three Layers

```
Prevention → Detection → Recovery
```

1. **Prevention**: Warn about large system prompts before session start
2. **Detection**: Wire SDK compaction events, emit context warnings, classify errors
3. **Recovery**: Enhanced error UI with retry/fresh-start options

---

## Layer 1: Prevention

### 1a. Fix `_get_context_max()` fallback

**File:** `backend/app/agent/service.py` — `_get_context_max()`

Use `_FALLBACK` from `model_registry.py` instead of hardcoding 200K:

```python
def _get_context_max(self, model_id: str) -> int:
    if self.model_registry:
        for m in self.model_registry.get_models():
            if m["id"] == model_id:
                return m["contextWindow"]
    from app.agent.model_registry import _FALLBACK
    for m in _FALLBACK:
        if m["id"] == model_id:
            return m["contextWindow"]
    return 200_000
```

### 1b. System prompt budget warnings in `build_context_structured()`

**File:** `backend/app/agent/context.py` — `build_context_structured()`

After computing `totalTokens`, compare against a budget. Add `warnings` and `budgetRatio` to the returned dict:

- `contextMax`: model's context window size
- `budgetRatio`: system prompt tokens / context window (0.0–1.0)
- `warnings`: human-readable warnings at 40% and 80% thresholds

### 1c. Message size estimation before send

**File:** `backend/app/agent/service.py` — `send_message()`

Before enqueueing a message, estimate its token count (heuristic: `len(text) / 6`). Compare against remaining context budget. If the message would consume >80% of remaining context, raise `MessageTooLargeError` (RPC error code `-32014`).

**File:** `backend/app/agent/tracker.py` — `_context_tokens: dict[str, int]` tracks per-session context usage from `agent/costEstimate` events.

### 1d. Surface warnings in RPC responses

**Files:** `backend/app/rpc/methods/agents.py` — `prepare_agent` and `update_draft`

Include `warnings`, `contextMax`, `budgetRatio` in the structured prompt response so the frontend can display budget indicators in the draft config card.

---

## Layer 2: Detection

### 2a. Wire `PreCompact` hook in runner

**File:** `backend/app/agent/runner.py`

Add `PreCompact` hook handler alongside existing `SubagentStart`/`SubagentStop`. Emits `agent/compact` event with `{trigger, preTokens}`. The frontend already renders these via `CompactMarker.tsx`.

### 2b. Context usage warnings

**File:** `backend/app/agent/service.py` — `_persisting_notify()`

When processing `agent/turnComplete` or `agent/error` events, check context usage ratio. Emit `agent/contextWarning` at 75% (`"warning"`) and 90% (`"critical"`).

### 2c. Classify "Prompt is too long" errors

**File:** `backend/app/agent/runner.py` — error handling block

Detect "Prompt is too long" / "prompt_too_long" / "context window" in error text. Use `subtype: "context_overflow"` instead of generic `"turn_error"`. Session stays idle (recoverable).

---

## Layer 3: Recovery

### 3a. Store last sent message for retry

**File:** `backend/app/agent/tracker.py` — `_last_messages: dict[str, str]`

Stores the last user message per session, set by `send_message()`, retrieved by `get_last_message()`.

### 3b. `retryLastMessage` RPC method

**File:** `backend/app/rpc/methods/agents.py`

New `agent/retryLastMessage` handler resends the last user message. SDK may auto-compact on retry.

### 3c. Enhanced ErrorBanner for context_overflow

**File:** `frontend/src/components/ChatStream/ErrorBanner.tsx`

When `subtype === "context_overflow"`, render "Context window full" with:
- **"Retry"** — calls `retryLastMessage` RPC
- **"Start fresh session"** — creates a new session with same config

### 3d. Frontend: context warning handler

**File:** `frontend/src/store/wireEvents.ts`

`agent/contextWarning` subscription shows toast: "Context 75% full" / "Context 90% full — compaction will happen soon".

---

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/agent/service.py` | Fix `_get_context_max()`, message size check in `send_message()`, context warnings in `_persisting_notify`, expose `get_last_message` |
| `backend/app/agent/runner.py` | Wire `PreCompact` hook, classify `context_overflow` errors |
| `backend/app/agent/context.py` | Add budget warnings to `build_context_structured()`, add `_get_model_context_max()` helper |
| `backend/app/agent/tracker.py` | Add `_last_messages` dict, `_context_tokens` dict, `set_last_message()`, `get_last_message()`, `set_context_tokens()`, `get_context_tokens()` |
| `backend/app/agent/models.py` | Add `MessageTooLargeError` exception class |
| `backend/app/rpc/methods/agents.py` | Add `retry_last_message` handler, surface warnings from structured prompt, handle `MessageTooLargeError` |
| `backend/app/rpc/server.py` | Register `agent/retryLastMessage` method |
| `frontend/src/components/ChatStream/ErrorBanner.tsx` | Context overflow recovery card with Retry/Fresh actions |
| `frontend/src/components/ChatStream/ChatStream.css` | Styles for `.chat-banner-body`, `.chat-banner-actions`, `.chat-banner-btn` |
| `frontend/src/api/methods/agents.ts` | Add `retryLastMessage` API method |
| `frontend/src/store/sessionStore.ts` | `retryLastMessage` action, `context_overflow` is recoverable |
| `frontend/src/store/wireEvents.ts` | `agent/contextWarning` handler, improved `context_overflow` toast |

## Verification

1. **Unit tests**: Test `_get_context_max` fallback, budget warning thresholds, error classification regex, message size rejection
2. **Integration test**: Create a session with many specs, verify warnings appear in RPC response
3. **Manual test — compaction**: Start a long conversation (many tool calls), verify `CompactMarker` appears in chat when SDK auto-compacts
4. **Manual test — overflow recovery**: Force a "Prompt is too long" error (e.g., use a model with very small context), verify the recovery card appears with Retry/Fresh buttons
5. **Manual test — warnings**: Watch `SessionStatusLine` context bar during a long session, verify toast appears at 75%/90%
