"""Tests for permissions._await_user_response timeout/retry behavior."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.agent.models import AgentConfig, AgentTask
from app.agent.permissions import _await_user_response
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.core.settings import ProjectSettings


def _make_task(tracker: Tracker) -> AgentTask:
    task = tracker.create_task(["s1"], AgentConfig())
    tracker.set_status(task.bonsai_sid, "idle")
    tracker.set_status(task.bonsai_sid, "running")
    return task


def _config() -> AppConfig:
    return AppConfig(
        project_root=Path("/tmp/test"),
        spec_dir=Path("/tmp/test/.specs"),
        plugin_dir=Path("/tmp/test/plugins"),
    )


class TestAwaitUserResponseInterrupt:
    """Default behavior: interrupt on timeout."""

    async def test_user_answers_immediately(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        # Resolve the future from a background task (simulates user answer)
        async def answer_soon():
            await asyncio.sleep(0.05)
            # Find and resolve the registered future
            futures = tracker._futures.get(task.bonsai_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.bonsai_sid, rid, {"behavior": "allow", "answers": {"q": "a"}})
                    break

        settings = ProjectSettings(user_respond_timeout=10)
        with patch("app.agent.permissions.load_settings", return_value=settings):
            asyncio.get_event_loop().create_task(answer_soon())
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/askUserQuestion",
                params={"bonsaiSid": task.bonsai_sid, "questions": []},
            )

        assert response is not None
        assert response["behavior"] == "allow"
        assert tracker.get_task(task.bonsai_sid).status == "running"

    async def test_timeout_returns_none(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        settings = ProjectSettings(
            user_respond_timeout=0.05,
            user_respond_timeout_behavior="interrupt",
        )
        with patch("app.agent.permissions.load_settings", return_value=settings):
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/askUserQuestion",
                params={"bonsaiSid": task.bonsai_sid, "questions": []},
            )

        assert response is None
        # Should have sent requestExpired notification
        expired_calls = [c for c in notify.call_args_list if c[0][0] == "agent/requestExpired"]
        assert len(expired_calls) == 1
        assert expired_calls[0][0][1]["requestId"] == request_id
        assert tracker.get_task(task.bonsai_sid).status == "running"


class TestAwaitUserResponseDeny:
    """Deny behavior: timeout returns None, caller decides interrupt=False."""

    async def test_deny_timeout_returns_none(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        settings = ProjectSettings(
            user_respond_timeout=0.05,
            user_respond_timeout_behavior="deny",
        )
        with patch("app.agent.permissions.load_settings", return_value=settings):
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/confirmAction",
                params={"bonsaiSid": task.bonsai_sid, "toolName": "Write"},
            )

        assert response is None
        assert tracker.get_task(task.bonsai_sid).status == "running"


class TestAwaitUserResponseRetry:
    """Retry behavior: re-sends notification with same request_id."""

    async def test_retry_reuses_request_id(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        settings = ProjectSettings(
            user_respond_timeout=0.05,
            user_respond_timeout_behavior="retry",
            user_respond_retry_max_attempts=2,
        )
        with patch("app.agent.permissions.load_settings", return_value=settings):
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/askUserQuestion",
                params={"bonsaiSid": task.bonsai_sid, "questions": []},
            )

        # Should have retried: 1 initial + 2 retries = 3 askUserQuestion calls
        ask_calls = [c for c in notify.call_args_list if c[0][0] == "agent/askUserQuestion"]
        assert len(ask_calls) == 3

        # All calls should use the same request_id
        request_ids = set()
        for call in ask_calls:
            _, kwargs = call
            rid = kwargs.get("request_id") or call[0][2] if len(call[0]) > 2 else None
            request_ids.add(rid)
        assert len(request_ids) == 1  # same request_id throughout

        # Attempt numbers should increment
        for i, call in enumerate(ask_calls):
            params = call[0][1]
            assert params["attempt"] == i

        # After exhausting retries, should have sent requestExpired
        expired_calls = [c for c in notify.call_args_list if c[0][0] == "agent/requestExpired"]
        assert len(expired_calls) == 1

    async def test_retry_user_answers_on_second_attempt(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()
        call_count = 0

        # Resolve on the second askUserQuestion call
        original_notify = notify

        async def counting_notify(method, params, request_id=None):
            nonlocal call_count
            if method == "agent/askUserQuestion":
                call_count += 1
                if call_count == 2:
                    # Answer on second attempt
                    await asyncio.sleep(0.02)
                    tracker.resolve_future(task.bonsai_sid, request_id, {"behavior": "allow", "answers": {"q": "a"}})

        notify = AsyncMock(side_effect=counting_notify)

        settings = ProjectSettings(
            user_respond_timeout=0.05,
            user_respond_timeout_behavior="retry",
            user_respond_retry_max_attempts=3,
        )
        with patch("app.agent.permissions.load_settings", return_value=settings):
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/askUserQuestion",
                params={"bonsaiSid": task.bonsai_sid, "questions": []},
            )

        assert response is not None
        assert response["behavior"] == "allow"
        assert call_count == 2  # answered on second attempt


class TestAwaitUserResponseInfiniteWait:
    """Timeout=0 means wait indefinitely."""

    async def test_infinite_timeout_waits(self) -> None:
        tracker = Tracker()
        task = _make_task(tracker)
        notify = AsyncMock()

        settings = ProjectSettings(user_respond_timeout=0)

        async def answer_after_delay():
            await asyncio.sleep(0.1)
            futures = tracker._futures.get(task.bonsai_sid, {})
            for rid, fut in futures.items():
                if not fut.done():
                    tracker.resolve_future(task.bonsai_sid, rid, {"behavior": "allow"})
                    break

        with patch("app.agent.permissions.load_settings", return_value=settings):
            asyncio.get_event_loop().create_task(answer_after_delay())
            response, request_id = await _await_user_response(
                tracker, notify, task, _config(),
                method="agent/askUserQuestion",
                params={"bonsaiSid": task.bonsai_sid, "questions": []},
            )

        assert response is not None
        assert response["behavior"] == "allow"
