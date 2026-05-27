---
id: context-management-design
type: architecture-design
status: active
title: 'Context Management: Observe Claude Code, Recover from Overflow'
parent: design-doc
tags:
- context-window
- error-recovery
---
# Context Management: Observe Claude Code, Recover from Overflow

## Context

Context window management — message history, compaction, summarization — is owned by the Claude Code subprocess that the Claude Agent SDK wraps. Bonsai does **not** manage the conversation log, trim messages, or run its own compaction. Bonsai's job is:

1. Assemble the **system prompt** from specs/skills/project metadata.
2. **Observe** what the SDK does at runtime: token usage per turn, compaction events.
3. **Recover** cleanly when the SDK reports `Prompt is too long` (the only context-window error that surfaces to the caller).

## Architecture: Two Layers

```
Detection → Recovery
```

- **Detection** — pure observability. Listen for SDK events (`PreCompact`, `ResultMessage.usage`), surface them to the UI as a passive status line / compact marker. No intervention.
- **Recovery** — when the SDK returns `Prompt is too long`, classify the error and offer two paths: retry the last message (the SDK will auto-compact on the retry) or start a fresh session with the same config.

There is **no Prevention layer**: no pre-flight message-size guard, no static system-prompt threshold warnings, no offline token-count API call. Bonsai cannot reliably predict when the SDK will compact, and predicting badly is worse than letting the SDK do its job and reacting to the rare overflow.

---

## Layer 1: Detection (Observability)

### 1a. `PreCompact` hook → `agent/compact` event

**File:** `backend/app/agent/runtime/claude/hooks.py` — `SubagentHooks.pre_compact_hook()`

The Claude SDK invokes `PreCompact` when the Claude Code subprocess is about to compact conversation history. Bonsai's hook emits `agent/compact` with `{trigger, preTokens}` where `preTokens` is the total tokens in the last API call. The frontend renders this as a `CompactMarker` in the chat stream so the user sees that compaction happened.

The hook does **not** intervene — it returns `{}` and lets the SDK proceed. The SDK owns the compaction logic.

### 1b. Per-turn token telemetry

**File:** `backend/app/agent/runtime/claude/runtime.py` — `run_session()`

For each `message_start` / `message_delta` SDK event, the runtime accumulates per-API-call token counts into an `iterations` list (input, output, cache-create-5m, cache-create-1h, cache-read). These are emitted as `agent/costEstimate` (live) and `agent/turnComplete` (final) events with:

- `currentContextWindow`: total tokens in the **latest** API call — this is the real context-window occupancy.
- `iterInputTokens` / `iterCacheRead` / `iterCacheCreate` / `iterOutputTokens`: the per-iteration breakdown for context-display UIs.

The frontend's `SessionStatusLine` renders `contextTokens / contextMax` from these values.

### 1c. Model context-window catalog

**File:** `backend/app/agent/runtime/claude/models.py` — `ClaudeModelRegistry`

Static catalog loaded from `runtime/claude/models.json` (`{id, label, contextWindow}` per entry). Used by:

- `service._get_context_max(task)` — populates `metrics.contextMax` in session metadata for the status-line UI.
- Frontend `getContextWindowSize(model)` — recomputes the same value client-side from the model registry when the user switches models.

Unknown ids fall back to `DEFAULT_CONTEXT_WINDOW` (200K).

### 1d. System-prompt token estimate (UI-only)

**File:** `backend/app/agent/context.py` — `_estimate_tokens()`

`build_context_structured()` reports `totalTokens` and per-section `tokens` via `len(text) // 4` — the rough chars-per-token ratio for Claude/cl100k-class tokenizers on English/markdown. This drives the stacked-bar preview in the draft config card and nothing else; once a session starts, the real `input_tokens` from `ResultMessage.usage` (surfaced via `agent/costEstimate`) takes over.

There is no Anthropic API call here — the estimate runs offline with zero dependencies.

---

## Layer 2: Recovery

### 2a. Classify `Prompt is too long`

**File:** `backend/app/agent/runtime/claude/runtime.py` — `ResultMessage` branch in `run_session()`

When the SDK returns an error `ResultMessage`, the runtime checks the message text for `prompt is too long` / `prompt_too_long` / `context window`. If matched, the emitted `agent/error` event uses `subtype: "context_overflow"` instead of the generic `"turn_error"`. The session stays idle (not terminated).

### 2b. Store last message for retry

**File:** `backend/app/agent/tracker.py` — `_last_messages: dict[str, str]`

`send_message()` calls `tracker.set_last_message()` before enqueuing. `get_last_message()` exposes it via `agent/retryLastMessage`.

### 2c. `agent/retryLastMessage` RPC method

**File:** `backend/app/rpc/methods/agents.py`

Resends the last user message through the same SDK client. The SDK will typically auto-compact on this retry and succeed. If it doesn't, the same `context_overflow` error fires and the user can fall back to a fresh session.

### 2d. ErrorBanner with Retry / Fresh Session actions

**File:** `frontend/src/components/ChatStream/ErrorBanner.tsx`

When `agent/error` arrives with `subtype === "context_overflow"`, the banner renders "Context window full" with two actions:

- **Retry** — calls `agent/retryLastMessage`.
- **Start fresh session** — creates a new session with the same config (model, specs, skill) and discards the conversation history.

---

## What Bonsai Deliberately Does NOT Do

| Anti-feature | Why |
|--------------|-----|
| Pre-flight message-size guard | The SDK can compact and proceed; predicting overflow with a `len(text) // N` heuristic and refusing to send is wrong more often than it's right. |
| Static 40%/80% system-prompt warnings | The static system prompt is a small fraction of real usage after a few turns; warning on it anchors UI on the wrong number. |
| Anthropic `count_tokens` REST call | Requires an API key separate from the SDK's auth path; adds a network dependency for a UI badge. The `// 4` heuristic is honest enough. |
| Runtime 75%/90% context-usage toasts | Duplicate of `currentContextWindow` already shown in the status line; the "compaction will happen soon" wording was misleading (the SDK decides when to compact, not Bonsai's static `contextMax * 0.9`). |
| Message-history trimming / summarization | Owned by Claude Code via `PreCompact`. The SDK does not expose the message log for caller manipulation. |

## Files

| File | Responsibility |
|------|----------------|
| `backend/app/agent/context.py` | System-prompt assembly; offline token estimator. |
| `backend/app/agent/service.py` | `_get_context_max()`, `send_message()` (no guard), `_last_messages` plumbing. |
| `backend/app/agent/tracker.py` | `_last_messages` for retry. |
| `backend/app/agent/runtime/claude/runtime.py` | Per-turn token telemetry; `context_overflow` classification. |
| `backend/app/agent/runtime/claude/hooks.py` | `PreCompact` → `agent/compact`. |
| `backend/app/agent/runtime/claude/models.py` | Static context-window catalog. |
| `backend/app/rpc/methods/agents.py` | `agent/retryLastMessage` handler. |
| `frontend/src/components/ChatStream/ErrorBanner.tsx` | Context-overflow recovery card. |
| `frontend/src/components/ChatStream/SessionStatusLine.tsx` | Passive `contextTokens / contextMax` display. |
| `frontend/src/store/wireEvents.ts` | `agent/compact` → CompactMarker; `agent/error` (subtype `context_overflow`) → ErrorBanner. |

## Verification

1. **Unit tests** — `_get_context_max` fallback, error-classification regex, `_last_messages` round-trip.
2. **Integration test** — start a session with many specs, verify `agent/compact` fires when the SDK compacts (long tool-heavy conversation).
3. **Manual test — overflow recovery** — force `Prompt is too long` (small-context model + large input), verify the recovery card appears and Retry works.
