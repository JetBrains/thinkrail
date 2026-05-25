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
    """Rewrite *text* into a faithful summarization via the Claude Code CLI.

    Args:
        text:  Raw voice transcript — may contain fillers, false starts, repetition.
        model: Override model id or alias. Defaults to ``"haiku"``.

    Returns:
        The revised message body (no preamble, no quotation).

    Raises:
        ClaudeSDKError: If the underlying ``claude_agent_sdk.query`` call fails
                        (transport, process, or upstream error). Propagated to
                        the RPC layer.
        RuntimeError:   If the SDK emits a ``ResultMessage`` with
                        ``is_error=True`` (in-band upstream failure that does
                        not raise an SDK exception).
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
| `claude_agent_sdk` | Python package | **Required** — already a project dep, used by `runtime/claude/runtime.py` |

No key resolution. The SDK's transport reads `ANTHROPIC_BASE_URL` and authenticates
via the same mechanism the rest of the Claude runtime uses (api_key_helper under
jbcentral; managed key under a stock Claude Code install).

## Error Handling

| Condition | Error | Message |
|---|---|---|
| Transport / process / upstream failure | Propagated | Standard SDK exceptions (e.g. `CLIConnectionError`, `ProcessError`) |
| In-band `ResultMessage` with `is_error=True` | `RuntimeError` | Carries `ResultMessage.result` |

All errors propagate to the RPC layer where `@_handle_errors` maps them to JSON-RPC
`-32603` internal error, surfaced in the frontend as the inline Retry banner.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Model | `"haiku"` alias by default | Fast, cheap, accurate enough for a copy-edit. The SDK / CLI resolves the alias to the current shipping Haiku, so we never pin a dated id that goes stale. Configurable per-call. |
| Transport | `claude_agent_sdk.query()` one-shot | Same SDK the runtime already uses. No direct `anthropic` import, no separate auth path. |
| Tools | `tools=[]`, `allowed_tools=[]`, `permission_mode="dontAsk"`, `max_turns=1` | Pure text transform; built-in tool set fully disabled, no auto-allowed tools, no prompts, single turn. |
| Streaming | Disabled | Response completes in well under a second; streaming adds frontend complexity for little UX win. |
| No audio persistence | N/A here | Audio never reaches this module — it only handles text. |

## Related Specs

- **Parent:** [Agent Module](README.md)
- **Feature design:** [Voice Input Design](../../../.bonsai/design_docs/VOICE_INPUT_DESIGN.md)
- **Sibling:** [Audio Transcription](TRANSCRIBE.md)
- **RPC method:** `agent/reviseTranscript` in [RPC Module](../rpc/README.md)
