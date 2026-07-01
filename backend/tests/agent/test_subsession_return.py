"""Tests for the discussion-subsession return-to-parent flow: origin capture,
persistence of the return/subsession fields, agent-drafted summary capture, and
approve-marks-done."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.agent.models import (
    AgentConfig,
    SessionReturnStatus,
    SubsessionOrigin,
    SubsessionOriginKind,
    SubsessionType,
    TaskStatus,
)
from app.agent.persistence import load_session
from app.agent.service import AgentService
from app.core.config import AppConfig


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / ".thinkrail_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


def _make_config(tmp_path: Path) -> AppConfig:
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir(exist_ok=True)
    return AppConfig(
        project_root=tmp_path, thinkrail_dir=thinkrail_dir, plugin_dir=plugin_dir,
    )


def _make_service(tmp_path: Path) -> AgentService:
    return AgentService(_make_config(tmp_path), MagicMock())


class TestSubsessionPersistence:
    def test_save_task_round_trips_return_and_origin_fields(self, tmp_path: Path) -> None:
        service = _make_service(tmp_path)
        task = service._tracker.create_task([], AgentConfig(), name="disc")
        task.parent_thinkrail_sid = "parent-1"
        task.subsession_type = SubsessionType.discussion
        task.subsession_context = "how to store tokens"
        task.subsession_origin = SubsessionOrigin(
            kind=SubsessionOriginKind.question, request_id="req-9", question_index=0,
        )
        task.return_status = SessionReturnStatus.PENDING
        task.return_summary = "use the keychain"
        service._save_task(task)

        data = load_session(tmp_path, task.thinkrail_sid)
        assert data is not None
        assert data["parentThinkrailSid"] == "parent-1"
        assert data["subsessionType"] == "discussion"
        assert data["subsessionContext"] == "how to store tokens"
        assert data["subsessionOrigin"] == {
            "kind": "question", "requestId": "req-9", "questionIndex": 0,
        }
        assert data["returnStatus"] == "pending"
        assert data["returnSummary"] == "use the keychain"


class TestCreateSubsessionOrigin:
    async def test_create_subsession_stores_origin(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from unittest.mock import AsyncMock

        service = _make_service(tmp_path)
        monkeypatch.setattr(service, "_build_context_for", AsyncMock(return_value=""))
        parent = service._tracker.create_task([], AgentConfig(), name="parent")
        service._save_task(parent)

        origin = SubsessionOrigin(kind=SubsessionOriginKind.question, request_id="req-9")
        child = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
            context="topic", name="disc", origin=origin,
        )

        assert child.subsession_origin == origin
        data = load_session(tmp_path, child.thinkrail_sid)
        assert data is not None
        assert data["subsessionOrigin"]["requestId"] == "req-9"


class TestSummaryCapture:
    def test_capture_reads_turn_text_when_awaiting(self, tmp_path: Path) -> None:
        service = _make_service(tmp_path)
        task = service._tracker.create_task([], AgentConfig(), name="disc")
        service._save_task(task)
        service._tracker.append_turn_text(task.thinkrail_sid, "Decision: use keychain.")
        service._tracker.mark_awaiting_summary(task.thinkrail_sid)

        captured = service._maybe_capture_summary(task)

        assert captured == "Decision: use keychain."
        assert task.return_summary == "Decision: use keychain."
        assert task.return_status == SessionReturnStatus.PENDING
        assert service._tracker.is_awaiting_summary(task.thinkrail_sid) is False
        # Persisted so a reload shows the drafted summary.
        data = load_session(tmp_path, task.thinkrail_sid)
        assert data is not None and data["returnSummary"] == "Decision: use keychain."

    def test_capture_noop_when_not_awaiting(self, tmp_path: Path) -> None:
        service = _make_service(tmp_path)
        task = service._tracker.create_task([], AgentConfig(), name="disc")
        service._tracker.append_turn_text(task.thinkrail_sid, "chatter")

        assert service._maybe_capture_summary(task) is None
        assert task.return_summary is None

    def test_capture_noop_when_turn_text_empty(self, tmp_path: Path) -> None:
        service = _make_service(tmp_path)
        task = service._tracker.create_task([], AgentConfig(), name="disc")
        service._tracker.mark_awaiting_summary(task.thinkrail_sid)

        assert service._maybe_capture_summary(task) is None
        # Flag stays set so a later non-empty turn can still capture.
        assert service._tracker.is_awaiting_summary(task.thinkrail_sid) is True


class TestApprove:
    def test_approve_marks_done(self, tmp_path: Path) -> None:
        service = _make_service(tmp_path)
        task = service._tracker.create_task([], AgentConfig(), name="disc")
        task.subsession_type = SubsessionType.discussion
        service._save_task(task)

        service.approve_summary(task.thinkrail_sid, "final text")

        assert task.return_status == SessionReturnStatus.APPROVED
        assert task.return_summary == "final text"
        assert task.status == TaskStatus.DONE
