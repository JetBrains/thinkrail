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
