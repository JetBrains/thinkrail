---
id: agent-transcribe
type: submodule-design
status: active
title: Audio Transcription — Submodule Design
parent: module-agent
implements:
- voice-input-design
covers:
- backend/app/agent/transcribe.py
tags:
- backend
- agent-orchestration
- voice
- whisper
---
# Audio Transcription — Submodule Design

> Parent: [README.md](README.md) | Status: **Active** | Created: 2026-03-11

## Purpose

Async audio transcription via OpenAI Whisper API. Used as the server-side fallback for browsers that lack the Web Speech API (Firefox, Safari). Receives base64-encoded audio from the frontend's `useVoiceInput` hook via the `agent/transcribe` RPC method.

## Public Interface

```python
async def transcribe(audio_base64: str, mime_type: str) -> str:
    """Decode base64 audio and transcribe via OpenAI Whisper API.

    Args:
        audio_base64: Base64-encoded audio data
        mime_type: Audio MIME type (e.g., "audio/webm", "audio/ogg")

    Returns:
        Transcribed text string

    Raises:
        RuntimeError: If openai package not installed or OPENAI_API_KEY missing
    """
```

## MIME Type Mapping

```python
_MIME_TO_EXT = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    # ... additional formats
}
```

The MIME type is mapped to a file extension for the Whisper API, which requires a filename with a recognized extension.

## Dependencies

| Dependency | Type | Required |
|------------|------|----------|
| `openai` | Python package | **Optional** — lazy imported on first call |
| `OPENAI_API_KEY` | Environment variable | Required at call time (not at import time) |

## Error Handling

| Condition | Error | Message |
|-----------|-------|---------|
| `openai` package not installed | `RuntimeError` | Includes install instruction: `cd backend && uv add openai` |
| `OPENAI_API_KEY` not set | `RuntimeError` | Includes note that browsers with Web Speech API don't need this key |
| Whisper API failure | Propagated from `openai` | Standard OpenAI error response |

All errors propagate to the RPC layer where `@_handle_errors` maps them to JSON-RPC error codes (`-32603` internal error).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Lazy imports | `openai` imported inside function body | Backend starts without openai installed; only fails when actually needed |
| base64 transport | Audio sent as base64 string, not multipart | Reuses JSON-RPC WebSocket transport; no HTTP upload endpoint needed |
| Optional dependency | Graceful degradation if openai missing | Chrome/Edge users never hit this path; only Firefox/Safari need it |
| No audio persistence | Audio decoded in memory, sent to Whisper, discarded | Privacy: voice data is transient |

## Related Specs

- **Parent:** [Agent Module](README.md)
- **Feature design:** [Voice Input Design](../../.bonsai/design_docs/VOICE_INPUT_DESIGN.md)
- **RPC method:** `agent/transcribe` in [RPC Module](../rpc/README.md)
