"""Tests for app.agent.revise — one-shot voice-transcript revise."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, TextBlock

from app.agent import revise


def _make_assistant_message(*texts: str) -> AssistantMessage:
    blocks = [TextBlock(text=t) for t in texts]
    return AssistantMessage(content=blocks, model=revise.DEFAULT_MODEL)


def _fake_query(*, captured: dict[str, Any] | None, messages: list[Any]):
    async def _gen(*, prompt: str, options: Any):
        if captured is not None:
            captured["prompt"] = prompt
            captured["options"] = options
        for m in messages:
            yield m

    return _gen


def test_default_model_is_haiku_alias():
    assert revise.DEFAULT_MODEL == "haiku"


@pytest.mark.asyncio
async def test_revise_returns_joined_stripped_text():
    messages = [_make_assistant_message("  clean text  ")]
    with patch.object(revise, "query", _fake_query(captured=None, messages=messages)):
        result = await revise.revise_transcript("uh, so, clean text")
    assert result == "clean text"


@pytest.mark.asyncio
async def test_revise_joins_multiple_text_blocks():
    messages = [_make_assistant_message("keep ", "this")]
    with patch.object(revise, "query", _fake_query(captured=None, messages=messages)):
        result = await revise.revise_transcript("raw")
    assert result == "keep this"


@pytest.mark.asyncio
async def test_revise_passes_explicit_model():
    captured: dict[str, Any] = {}
    messages = [_make_assistant_message("ok")]
    with patch.object(revise, "query", _fake_query(captured=captured, messages=messages)):
        await revise.revise_transcript("hello", model="claude-sonnet-4-6")
    assert captured["options"].model == "claude-sonnet-4-6"
    assert captured["options"].system_prompt == revise.SYSTEM_PROMPT
    assert captured["options"].tools == []
    assert captured["options"].allowed_tools == []
    assert captured["options"].permission_mode == "dontAsk"
    assert captured["options"].max_turns == 1


@pytest.mark.asyncio
async def test_revise_uses_default_model_when_none():
    captured: dict[str, Any] = {}
    messages = [_make_assistant_message("ok")]
    with patch.object(revise, "query", _fake_query(captured=captured, messages=messages)):
        await revise.revise_transcript("hello")
    assert captured["options"].model == revise.DEFAULT_MODEL


@pytest.mark.asyncio
async def test_revise_ignores_non_assistant_messages():
    class _OtherMessage:
        pass

    messages = [_OtherMessage(), _make_assistant_message("kept")]
    with patch.object(revise, "query", _fake_query(captured=None, messages=messages)):
        result = await revise.revise_transcript("raw")
    assert result == "kept"


@pytest.mark.asyncio
async def test_revise_raises_when_stream_yields_no_text():
    ok = ResultMessage(
        subtype="result",
        duration_ms=0,
        duration_api_ms=0,
        is_error=False,
        num_turns=0,
        session_id="",
        result=None,
    )
    with patch.object(revise, "query", _fake_query(captured=None, messages=[ok])):
        with pytest.raises(RuntimeError, match="produced no text"):
            await revise.revise_transcript("raw")


@pytest.mark.asyncio
async def test_revise_raises_on_result_message_error():
    err = ResultMessage(
        subtype="error",
        duration_ms=0,
        duration_api_ms=0,
        is_error=True,
        num_turns=0,
        session_id="",
        result="upstream API error",
    )
    messages = [_make_assistant_message("partial"), err]
    with patch.object(revise, "query", _fake_query(captured=None, messages=messages)):
        with pytest.raises(RuntimeError, match="upstream API error"):
            await revise.revise_transcript("raw")
