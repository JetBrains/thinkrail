from __future__ import annotations

import pytest
from app.agent.models import AgentTask, SubsessionType


class TestSubsessionType:
    def test_enum_values(self) -> None:
        assert SubsessionType.discussion == "discussion"
        assert SubsessionType.refinement == "refinement"

    def test_enum_from_string(self) -> None:
        assert SubsessionType("discussion") is SubsessionType.discussion
        assert SubsessionType("refinement") is SubsessionType.refinement


class TestAgentTaskSubsessionFields:
    def test_defaults_are_none(self) -> None:
        task = AgentTask()
        assert task.parent_thinkrail_sid is None
        assert task.subsession_type is None
        assert task.subsession_context is None
        assert task.return_status is None
        assert task.return_summary is None

    def test_set_subsession_fields(self) -> None:
        task = AgentTask(
            parent_thinkrail_sid="parent-123",
            subsession_type=SubsessionType.discussion,
            subsession_context="selected text here",
        )
        assert task.parent_thinkrail_sid == "parent-123"
        assert task.subsession_type == SubsessionType.discussion
        assert task.subsession_context == "selected text here"

    def test_camel_case_serialization(self) -> None:
        task = AgentTask(
            parent_thinkrail_sid="p-1",
            subsession_type=SubsessionType.refinement,
            subsession_context="voice transcript",
            return_status="pending",
            return_summary="cleaned up text",
        )
        data = task.model_dump(by_alias=True)
        assert data["parentThinkrailSid"] == "p-1"
        assert data["subsessionType"] == "refinement"
        assert data["subsessionContext"] == "voice transcript"
        assert data["returnStatus"] == "pending"
        assert data["returnSummary"] == "cleaned up text"

    def test_is_subsession_property(self) -> None:
        regular = AgentTask()
        assert regular.parent_thinkrail_sid is None

        sub = AgentTask(parent_thinkrail_sid="p-1", subsession_type=SubsessionType.discussion)
        assert sub.parent_thinkrail_sid is not None


from pathlib import Path
from app.agent.context import build_parent_context
from app.agent.persistence import append_event, list_children, save_session


class TestListChildren:
    def test_returns_empty_for_no_children(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        result = list_children(tmp_path, "parent-1")
        assert result == []

    def test_returns_matching_children(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "parent-1", "name": "Main", "status": "idle"})
        save_session(tmp_path, {"thinkrailSid": "child-1", "name": "Discuss auth", "status": "done", "parentThinkrailSid": "parent-1", "subsessionType": "discussion"})
        save_session(tmp_path, {"thinkrailSid": "other-1", "name": "Other", "status": "done"})
        children = list_children(tmp_path, "parent-1")
        assert len(children) == 1
        assert children[0]["thinkrailSid"] == "child-1"

    def test_does_not_return_grandchildren(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "child-1", "parentThinkrailSid": "parent-1", "name": "Child", "status": "done"})
        save_session(tmp_path, {"thinkrailSid": "grandchild-1", "parentThinkrailSid": "child-1", "name": "Grandchild", "status": "done"})
        children = list_children(tmp_path, "parent-1")
        assert len(children) == 1
        assert children[0]["thinkrailSid"] == "child-1"


class TestBuildParentContext:
    def test_builds_context_from_parent_events(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "parent-1", "name": "Main", "status": "idle"})
        append_event(tmp_path, "parent-1", {"eventType": "userMessage", "payload": {"text": "What auth should we use?"}})
        append_event(tmp_path, "parent-1", {"eventType": "textDelta", "payload": {"text": "I recommend JWT tokens."}})
        append_event(tmp_path, "parent-1", {"eventType": "turnComplete", "payload": {}})

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context="JWT tokens",
            project_root=tmp_path,
        )
        assert "Parent Session Context" in result
        assert "What auth should we use?" in result
        assert "I recommend JWT tokens." in result
        assert "JWT tokens" in result
        assert "discuss" in result.lower()

    def test_context_for_refinement_type(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "parent-1", "name": "Main", "status": "idle"})

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.refinement,
            subsession_context="so basically i want the thing to handle auth",
            project_root=tmp_path,
        )
        assert "clean up" in result.lower()
        assert "message editor" in result.lower()
        assert "so basically i want the thing to handle auth" in result

    def test_truncates_long_conversations(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "parent-1", "name": "Main", "status": "idle"})
        for i in range(50):
            append_event(tmp_path, "parent-1", {"eventType": "userMessage", "payload": {"text": f"Message {i}: " + "x" * 100}})
            append_event(tmp_path, "parent-1", {"eventType": "textDelta", "payload": {"text": f"Response {i}: " + "y" * 100}})
            append_event(tmp_path, "parent-1", {"eventType": "turnComplete", "payload": {}})

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context=None,
            project_root=tmp_path,
        )
        assert len(result) < 8000
        assert "Message 49" in result

    def test_no_parent_events_returns_minimal_context(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".tr" / "sessions"
        sessions_dir.mkdir(parents=True)
        save_session(tmp_path, {"thinkrailSid": "parent-1", "name": "Main", "status": "idle"})

        result = build_parent_context(
            parent_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            subsession_context="some topic",
            project_root=tmp_path,
        )
        assert "Parent Session Context" in result
        assert "some topic" in result


from unittest.mock import AsyncMock, MagicMock
from app.agent.service import AgentService
from app.agent.models import AgentConfig
from app.core.config import AppConfig


def _make_service(tmp_path: Path) -> tuple[AgentService, MagicMock]:
    config = MagicMock(spec=AppConfig)
    config.project_root = tmp_path
    config.get_thinkrail_dir.return_value = tmp_path / ".tr"
    plugin_dir = tmp_path / "plugins"
    plugin_dir.mkdir(parents=True, exist_ok=True)
    config.plugin_dir = plugin_dir
    spec_service = MagicMock()
    mock_spec = MagicMock()
    mock_spec.title = "Mock Spec"
    mock_spec.content = "Mock content"
    spec_service.get_spec = AsyncMock(return_value=mock_spec)

    (tmp_path / ".tr" / "sessions").mkdir(parents=True, exist_ok=True)

    service = AgentService(config, spec_service)
    return service, spec_service


class TestCreateSubsession:
    async def test_creates_subsession_with_parent_link(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = await service.prepare_task([], AgentConfig(), name="Main session")
        sub = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
            context="JWT vs sessions",
            name="Discuss auth",
        )
        assert sub.parent_thinkrail_sid == parent.thinkrail_sid
        assert sub.subsession_type == SubsessionType.discussion
        assert sub.subsession_context == "JWT vs sessions"
        assert sub.name == "Discuss auth"
        assert sub.status == "draft"

    async def test_inherits_parent_specs_and_config(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = await service.prepare_task(
            ["spec-1", "spec-2"],
            AgentConfig(model="claude-opus-4-6"),
            name="Main",
        )
        sub = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
        )
        assert sub.spec_ids == parent.spec_ids
        assert sub.config.model == parent.config.model

    async def test_raises_for_nonexistent_parent(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        with pytest.raises((ValueError, Exception)):
            await service.create_subsession(
                parent_thinkrail_sid="nonexistent",
                subsession_type=SubsessionType.discussion,
            )


class TestReturnFlow:
    async def test_request_summary_sets_pending(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = await service.prepare_task([], AgentConfig(), name="Main")
        sub = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
        )
        service._tracker.set_status(sub.thinkrail_sid, "initializing")
        service._tracker.set_status(sub.thinkrail_sid, "idle")
        service.request_summary(sub.thinkrail_sid)
        assert sub.return_status == "pending"

    async def test_approve_summary_stores_text(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = await service.prepare_task([], AgentConfig(), name="Main")
        sub = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
        )
        service.approve_summary(sub.thinkrail_sid, "Decision: use JWT")
        assert sub.return_status == "approved"
        assert sub.return_summary == "Decision: use JWT"

    async def test_dismiss_summary_sets_dismissed(self, tmp_path: Path) -> None:
        service, _ = _make_service(tmp_path)
        parent = await service.prepare_task([], AgentConfig(), name="Main")
        sub = await service.create_subsession(
            parent_thinkrail_sid=parent.thinkrail_sid,
            subsession_type=SubsessionType.discussion,
        )
        service.dismiss_summary(sub.thinkrail_sid)
        assert sub.return_status == "dismissed"
        assert sub.return_summary is None
