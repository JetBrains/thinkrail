# Task: Revise Transcript Backend

> Status: **Pending** | Created: 2026-04-16

## Summary

Implement a server-side one-shot LLM call that rewrites a raw voice transcript into a
faithful, concise message. Expose it via the `agent/reviseTranscript` RPC method. Powers
the default `voice_revise_mode = "auto"` flow.

## Covers

- `backend/app/agent/revise.py`
- `backend/app/rpc/methods/agents.py` (`revise_transcript_rpc` handler)
- `backend/app/rpc/server.py` (method registration)
- `backend/app/core/settings.py` (`voice_revise_mode` field)
- `backend/tests/agent/test_revise.py`
- `backend/tests/rpc/test_server.py` (extension)
- `backend/tests/core/test_settings.py` (extension)

## Acceptance Criteria

- [ ] `revise_transcript(text, model=None)` calls the Anthropic SDK with a single user turn
      and returns the response text.
- [ ] Model defaults to `claude-haiku-4-5`; caller can override per-call.
- [ ] `resolve_anthropic_api_key()` is the sole credential source.
- [ ] Missing API key raises `RuntimeError` with a descriptive message.
- [ ] RPC method `agent/reviseTranscript` accepts `{ text, model? }` and returns `{ text }`.
- [ ] `ProjectSettings.voice_revise_mode` defaults to `"auto"`; unknown values round-trip
      via `extra = "allow"`.
- [ ] Unit tests cover happy path, missing key, and RPC round-trip.

## Design Reference

- Submodule spec: [REVISE.md](../../../backend/app/agent/REVISE.md)
- Parent design: [.bonsai/design_docs/VOICE_INPUT_DESIGN.md](../../design_docs/VOICE_INPUT_DESIGN.md) (Revision 2)
