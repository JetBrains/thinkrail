---
id: agent-revise
type: submodule-design
status: active
title: Transcript Revision — Submodule Design
parent: module-agent
covers:
- backend/app/agent/revise.py
tags:
- voice
- transcript
- revise
---
# Transcript Revision — Submodule Design

> Parent: [README.md](README.md) | Status: **Active** | Created: 2026-04-16

## Purpose

One-shot LLM call that rewrites a raw voice transcript into a faithful, concise message
suitable for sending to an agent. Used after [TRANSCRIBE.md](TRANSCRIBE.md) has produced
the transcript (or after the browser's Web Speech API has). The revise call runs on the
backend (no agent loop, no subsession) so the result lands back in the user's input box
within roughly one second.

## Public Interface

```python
async def revise_transcript(text: str, model: str | None = None) -> str:
    """Rewrite *text* into a faithful summarization via the Anthropic API.

    Args:
        text:  Raw voice transcript — may contain fillers, false starts, repetition.
        model: Override model id. Defaults to ``claude-haiku-4-5``.

    Returns:
        The revised message body (no preamble, no quotation).

    Raises:
        RuntimeError: If the ``anthropic`` SDK is missing or no API key can be
                      resolved via ``resolve_anthropic_api_key()``.
    """
```

## System Prompt

```
You are a concise editor. The user has just dictated a message by voice, so the input
contains fillers, false starts, and spoken phrasing. Produce a faithful summarization
that preserves every concrete detail (facts, names, numbers, requests, constraints)
while removing disfluencies and repetition. Use short paragraphs or bullets only when
they actually help readability. Output only the revised message — no preamble, no
quotation.
```

## Dependencies

| Dependency | Type | Required |
|---|---|---|
| `anthropic` | Python package | **Required** — already a project dep (see `model_registry.py`, `context.py`) |
| `resolve_anthropic_api_key()` | Internal helper | Resolves env var `ANTHROPIC_API_KEY` or the Claude Code managed key on macOS |

## Error Handling

| Condition | Error | Message |
|---|---|---|
| `anthropic` package not installed | `RuntimeError` | Includes install hint: `cd backend && uv add anthropic` |
| No API key available | `RuntimeError` | "No Anthropic API key available. Set ANTHROPIC_API_KEY or run `claude auth login`." |
| Anthropic API failure | Propagated | Standard SDK exception (e.g. `anthropic.APIError`) |

All errors propagate to the RPC layer where `@_handle_errors` maps them to JSON-RPC
`-32603` internal error, surfaced in the frontend as the inline Retry banner.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Model | `claude-haiku-4-5` by default | Fast, cheap, and accurate enough for a copy-edit. Configurable per-call. |
| Turn count | Single user turn, no tools | This is a pure text transform; no need for an agent loop. |
| Streaming | Disabled (MVP) | Response completes in well under a second; streaming adds frontend complexity for little UX win. |
| `max_tokens` | 2048 | Generous cap for a voice transcript (≈15 minutes of speech); still cheap. |
| No audio persistence | N/A here | Audio never reaches this module — it only handles text. |
| Credential source | Shared with model registry | Reuses `resolve_anthropic_api_key()` so users already logged into Claude Code get auto-revise for free. |

## Related Specs

- **Parent:** [Agent Module](README.md)
- **Feature design:** [Voice Input Design](../../../.bonsai/design_docs/VOICE_INPUT_DESIGN.md)
- **Sibling:** [Audio Transcription](TRANSCRIBE.md)
- **RPC method:** `agent/reviseTranscript` in [RPC Module](../rpc/README.md)
