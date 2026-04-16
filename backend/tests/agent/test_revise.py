"""Tests for app.agent.revise — one-shot voice-transcript revise."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.agent import revise


class _FakeAsyncMessagesAPI:
    """Stub for ``AsyncAnthropic().messages.create``."""

    def __init__(self, response_text: str):
        self.create = AsyncMock(return_value=SimpleNamespace(
            content=[SimpleNamespace(type="text", text=response_text)],
        ))


class _FakeAsyncAnthropic:
    def __init__(self, api_key: str, response_text: str = "revised"):
        self.api_key = api_key
        self.messages = _FakeAsyncMessagesAPI(response_text)


@pytest.mark.asyncio
async def test_revise_returns_text(monkeypatch):
    monkeypatch.setattr(revise, "resolve_anthropic_api_key", lambda: "sk-ant-test")

    fake_cls = lambda api_key: _FakeAsyncAnthropic(api_key, response_text="clean text")
    with patch("anthropic.AsyncAnthropic", fake_cls):
        result = await revise.revise_transcript("uh, so, clean text")
    assert result == "clean text"


@pytest.mark.asyncio
async def test_revise_passes_explicit_model(monkeypatch):
    monkeypatch.setattr(revise, "resolve_anthropic_api_key", lambda: "sk-ant-test")

    captured: dict = {}

    class _CaptureAnthropic:
        def __init__(self, api_key: str):
            self.messages = SimpleNamespace(
                create=AsyncMock(
                    side_effect=lambda **kwargs: (
                        captured.update(kwargs),
                        SimpleNamespace(content=[SimpleNamespace(type="text", text="ok")])
                    )[1],
                )
            )

    with patch("anthropic.AsyncAnthropic", _CaptureAnthropic):
        await revise.revise_transcript("hello", model="claude-sonnet-4-6")
    assert captured["model"] == "claude-sonnet-4-6"
    assert captured["max_tokens"] == revise.MAX_TOKENS


@pytest.mark.asyncio
async def test_revise_uses_default_model(monkeypatch):
    monkeypatch.setattr(revise, "resolve_anthropic_api_key", lambda: "sk-ant-test")

    captured: dict = {}

    class _CaptureAnthropic:
        def __init__(self, api_key: str):
            self.messages = SimpleNamespace(
                create=AsyncMock(
                    side_effect=lambda **kwargs: (
                        captured.update(kwargs),
                        SimpleNamespace(content=[SimpleNamespace(type="text", text="ok")])
                    )[1],
                )
            )

    with patch("anthropic.AsyncAnthropic", _CaptureAnthropic):
        await revise.revise_transcript("hello")
    assert captured["model"] == revise.DEFAULT_MODEL


@pytest.mark.asyncio
async def test_revise_without_key_raises(monkeypatch):
    monkeypatch.setattr(revise, "resolve_anthropic_api_key", lambda: None)
    with pytest.raises(RuntimeError, match="No Anthropic API key"):
        await revise.revise_transcript("hello")


@pytest.mark.asyncio
async def test_revise_ignores_non_text_blocks(monkeypatch):
    monkeypatch.setattr(revise, "resolve_anthropic_api_key", lambda: "sk-ant-test")

    class _MultiBlockAnthropic:
        def __init__(self, api_key: str):
            self.messages = SimpleNamespace(
                create=AsyncMock(return_value=SimpleNamespace(
                    content=[
                        SimpleNamespace(type="tool_use", text="<ignored>"),
                        SimpleNamespace(type="text", text="keep "),
                        SimpleNamespace(type="text", text="this"),
                    ],
                )),
            )

    with patch("anthropic.AsyncAnthropic", _MultiBlockAnthropic):
        result = await revise.revise_transcript("raw")
    assert result == "keep this"
