"""Tests for the agent tools package — SuggestSession, visualization, and interceptor routing."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.models import AgentConfig, AgentTask
from app.agent.tracker import Tracker
from app.core.config import AppConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(tmp_path: Path) -> AppConfig:
    """Build an AppConfig rooted in a temp directory."""
    spec_dir = tmp_path / ".specs"
    spec_dir.mkdir()
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    return AppConfig(
        project_root=tmp_path,
        spec_dir=spec_dir,
        plugin_dir=plugin_dir,
    )


def _make_tracker_and_task() -> tuple[Tracker, AgentTask]:
    """Create a Tracker with a task in idle state."""
    tracker = Tracker()
    task = tracker.create_task(["spec-1"], AgentConfig())
    return tracker, task


def _write_registry(path: Path, spec_ids: list[str]) -> None:
    """Write a minimal registry.json with the given spec IDs."""
    data = {
        "version": "2.0",
        "project": "test",
        "specs": [{"id": sid, "type": "module", "path": f"/{sid}", "title": sid} for sid in spec_ids],
        "links": [],
    }
    path.write_text(json.dumps(data), encoding="utf-8")


# ===========================================================================
# _validate_skill — unit tests
# ===========================================================================


class TestValidateSkill:
    def test_validate_skill_exists(self, tmp_path: Path) -> None:
        """Skill directory with SKILL.md → returns None."""
        from app.agent.tools.suggest_session import _validate_skill

        skill_dir = tmp_path / "skills" / "module-design"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")

        assert _validate_skill("module-design", tmp_path) is None

    def test_validate_skill_missing(self, tmp_path: Path) -> None:
        """Skill that doesn't exist → returns error string."""
        from app.agent.tools.suggest_session import _validate_skill

        result = _validate_skill("nonexistent", tmp_path)
        assert result == "Unknown skill: nonexistent"


# ===========================================================================
# _validate_spec_ids — unit tests
# ===========================================================================


class TestValidateSpecIds:
    def test_validate_spec_ids_empty_list(self, tmp_path: Path) -> None:
        """Empty list → short-circuit, returns None."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        # Path doesn't even need to exist — empty list short-circuits
        assert _validate_spec_ids([], tmp_path / "registry.json") is None

    def test_validate_spec_ids_all_valid(self, tmp_path: Path) -> None:
        """All IDs present in registry → returns None."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        registry_path = tmp_path / "registry.json"
        _write_registry(registry_path, ["a", "b"])

        assert _validate_spec_ids(["a", "b"], registry_path) is None

    def test_validate_spec_ids_some_missing(self, tmp_path: Path) -> None:
        """Some IDs missing → returns error naming the missing ones."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        registry_path = tmp_path / "registry.json"
        _write_registry(registry_path, ["a"])

        result = _validate_spec_ids(["a", "b"], registry_path)
        assert result is not None
        assert "Unknown specIds: b" in result

    def test_validate_spec_ids_registry_unavailable(self, tmp_path: Path) -> None:
        """Non-existent registry → returns error containing 'registry unavailable'."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        result = _validate_spec_ids(["x"], tmp_path / "no-such-registry.json")
        assert result is not None
        assert "registry unavailable" in result


# ===========================================================================
# intercept_suggest_session — async tests
# ===========================================================================


class TestInterceptSuggestSession:
    async def test_intercept_approve_flow(self, tmp_path: Path) -> None:
        """Approve → PermissionResultAllow with approved=True in updated_input."""
        from app.agent.tools.suggest_session import intercept_suggest_session

        config = _make_config(tmp_path)
        # Create skill on disk
        skill_dir = config.plugin_dir / "skills" / "module-design"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")
        # Create registry with a valid specId
        _write_registry(config.get_registry_path(), ["spec-a"])

        tracker, task = _make_tracker_and_task()
        tracker.set_status(task.bonsai_sid, "running")
        notify = AsyncMock()

        input_data = {
            "skill": "module-design",
            "specIds": ["spec-a"],
            "name": "Design: Agent Module",
            "reason": "Needs its own spec.",
        }

        # Schedule future resolution (approve) after a tick
        async def resolve_approve():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(task.bonsai_sid, req_id, {"behavior": "allow"})
                break

        asyncio.get_event_loop().create_task(resolve_approve())

        result = await intercept_suggest_session(input_data, tracker, notify, task, config)

        assert result.behavior == "allow"
        assert result.updated_input["approved"] is True
        assert "dismissed" not in result.updated_input

        # Verify notify was called with the right method and params
        notify.assert_called_once()
        call_args = notify.call_args
        assert call_args.args[0] == "agent/suggestSession"
        params = call_args.args[1]
        assert params["bonsaiSid"] == task.bonsai_sid
        assert params["skill"] == "module-design"
        assert params["specIds"] == ["spec-a"]
        assert params["name"] == "Design: Agent Module"
        assert params["reason"] == "Needs its own spec."

    async def test_intercept_dismiss_flow(self, tmp_path: Path) -> None:
        """Dismiss → PermissionResultAllow (not Deny!) with dismissed=True."""
        from app.agent.tools.suggest_session import intercept_suggest_session

        config = _make_config(tmp_path)
        skill_dir = config.plugin_dir / "skills" / "task-spec"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")

        tracker, task = _make_tracker_and_task()
        tracker.set_status(task.bonsai_sid, "running")
        notify = AsyncMock()

        input_data = {
            "skill": "task-spec",
            "specIds": [],
            "name": "Some Task",
            "reason": "Because.",
        }

        async def resolve_deny():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(task.bonsai_sid, req_id, {"behavior": "deny"})
                break

        asyncio.get_event_loop().create_task(resolve_deny())

        result = await intercept_suggest_session(input_data, tracker, notify, task, config)

        # Key invariant: never PermissionResultDeny — always Allow
        assert result.behavior == "allow"
        assert result.updated_input["dismissed"] is True
        assert "approved" not in result.updated_input

    async def test_intercept_validation_failure_bad_skill(self, tmp_path: Path) -> None:
        """Invalid skill → returns Allow with error, no future registered."""
        from app.agent.tools.suggest_session import intercept_suggest_session

        config = _make_config(tmp_path)
        # No skill on disk

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()

        input_data = {
            "skill": "nonexistent-skill",
            "specIds": [],
            "name": "Bad Skill",
            "reason": "Testing.",
        }

        result = await intercept_suggest_session(input_data, tracker, notify, task, config)

        assert result.behavior == "allow"
        assert "error" in result.updated_input
        assert "Unknown skill: nonexistent-skill" in result.updated_input["error"]
        # No future should have been registered
        assert not tracker._futures.get(task.bonsai_sid, {})
        # No notification sent
        notify.assert_not_called()

    async def test_intercept_validation_failure_bad_spec_id(self, tmp_path: Path) -> None:
        """Valid skill but invalid specId → returns Allow with error."""
        from app.agent.tools.suggest_session import intercept_suggest_session

        config = _make_config(tmp_path)
        # Create valid skill
        skill_dir = config.plugin_dir / "skills" / "module-design"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")
        # Registry with only "a"
        _write_registry(config.get_registry_path(), ["a"])

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()

        input_data = {
            "skill": "module-design",
            "specIds": ["a", "missing-spec"],
            "name": "Bad Spec",
            "reason": "Testing.",
        }

        result = await intercept_suggest_session(input_data, tracker, notify, task, config)

        assert result.behavior == "allow"
        assert "error" in result.updated_input
        assert "Unknown specIds: missing-spec" in result.updated_input["error"]
        assert not tracker._futures.get(task.bonsai_sid, {})
        notify.assert_not_called()


# ===========================================================================
# intercept_visualize — async test
# ===========================================================================


class TestInterceptVisualize:
    async def test_intercept_visualize_auto_approve(self, tmp_path: Path) -> None:
        """intercept_visualize returns Allow immediately, no side effects."""
        from app.agent.tools.visualization import intercept_visualize

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()

        input_data = {"type": "summary-box", "title": "Test", "data": {"text": "hi"}}

        result = await intercept_visualize(input_data, tracker, notify, task, config)

        assert result.behavior == "allow"
        # No future, no notification
        assert not tracker._futures.get(task.bonsai_sid, {})
        notify.assert_not_called()


# ===========================================================================
# INTERCEPTORS routing via permissions.py — integration tests
# ===========================================================================


class TestInterceptorRouting:
    async def test_interceptor_suffix_match_suggest_session(self, tmp_path: Path) -> None:
        """can_use_tool with SuggestSession suffix dispatches to intercept_suggest_session."""
        from unittest.mock import patch

        from app.agent.permissions import can_use_tool

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        context = MagicMock()

        mock_result = MagicMock()
        mock_result.behavior = "allow"

        mock_intercept = AsyncMock(return_value=mock_result)

        # INTERCEPTORS is a dict imported by reference — patch via dict replacement
        with patch.dict(
            "app.agent.tools.INTERCEPTORS",
            {"SuggestSession": mock_intercept},
        ):
            # The SDK prefixes with "mcp__bonsai-proactive__"
            result = await can_use_tool(
                "mcp__bonsai-proactive__SuggestSession",
                {"skill": "x", "name": "n", "reason": "r"},
                context,
                tracker=tracker,
                notify=notify,
                task=task,
                config=config,
            )

        mock_intercept.assert_called_once()
        assert result is mock_result

    async def test_interceptor_suffix_match_visualize(self, tmp_path: Path) -> None:
        """can_use_tool with bonsai_visualize suffix dispatches to intercept_visualize."""
        from unittest.mock import patch

        from app.agent.permissions import can_use_tool

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        context = MagicMock()

        mock_result = MagicMock()
        mock_result.behavior = "allow"

        mock_intercept = AsyncMock(return_value=mock_result)

        with patch.dict(
            "app.agent.tools.INTERCEPTORS",
            {"bonsai_visualize": mock_intercept},
        ):
            result = await can_use_tool(
                "mcp__bonsai-viz__bonsai_visualize",
                {"type": "diagram", "data": {}},
                context,
                tracker=tracker,
                notify=notify,
                task=task,
                config=config,
            )

        mock_intercept.assert_called_once()
        assert result is mock_result


# ===========================================================================
# _suggest_session handler — unit tests
# ===========================================================================


class TestSuggestSessionHandler:
    async def test_handler_approved(self) -> None:
        """approved=True → content contains 'approved and created'."""
        from app.agent.tools.suggest_session import _suggest_session

        # @tool decorator wraps the function in SdkMcpTool; .handler is the raw async fn
        result = await _suggest_session.handler({"approved": True, "name": "Design: X"})
        text = result["content"][0]["text"]
        assert "approved and created" in text
        assert "Design: X" in text

    async def test_handler_dismissed(self) -> None:
        """dismissed=True → content contains 'dismissed'."""
        from app.agent.tools.suggest_session import _suggest_session

        result = await _suggest_session.handler({"dismissed": True})
        text = result["content"][0]["text"]
        assert "dismissed" in text.lower()

    async def test_handler_error(self) -> None:
        """error field → content contains 'Error: ...'."""
        from app.agent.tools.suggest_session import _suggest_session

        result = await _suggest_session.handler({"error": "Unknown skill"})
        text = result["content"][0]["text"]
        assert "Error: Unknown skill" in text
