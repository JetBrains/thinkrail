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
                "mcp__bonsai-vis__bonsai_visualize",
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
        """error field → isError=True and content contains 'Error: ...'."""
        from app.agent.tools.suggest_session import _suggest_session

        result = await _suggest_session.handler({"error": "Unknown skill"})
        text = result["content"][0]["text"]
        assert "Error: Unknown skill" in text
        assert result["isError"] is True


# ===========================================================================
# _validate_vis_data — unit tests
# ===========================================================================


class TestValidateVisData:
    """Tests for the visualization data validation function."""

    def test_valid_progress_tracker(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"steps": [{"label": "Step 1", "status": "done"}, {"label": "Step 2", "status": "pending"}]}
        assert _validate_vis_data("progress-tracker", data) is None

    def test_valid_summary_box(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"sections": [{"heading": "Info", "items": [{"label": "Key", "value": "Val"}]}]}
        assert _validate_vis_data("summary-box", data) is None

    def test_valid_comparison(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"options": [{"name": "Option A", "pros": ["fast"], "cons": ["complex"]}]}
        assert _validate_vis_data("comparison", data) is None

    def test_valid_data_table(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"columns": ["Name", "Status"], "rows": [["foo", "done"], ["bar", "pending"]]}
        assert _validate_vis_data("data-table", data) is None

    def test_valid_status_list(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"items": [{"label": "Item 1", "status": "done", "meta": "All good"}]}
        assert _validate_vis_data("status-list", data) is None

    def test_valid_diagram_structured(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a", "to": "b"}]}
        assert _validate_vis_data("diagram", data) is None

    def test_valid_diagram_text(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"diagram": "A --> B --> C"}
        assert _validate_vis_data("diagram", data) is None

    def test_valid_diagram_text_with_notation(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"diagram": "graph LR\n  A --> B", "notation": "mermaid"}
        assert _validate_vis_data("diagram", data) is None

    def test_valid_comparison_with_visualization(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"options": [{"name": "Option A", "visualization": "graph TD\n  A --> B"}]}
        assert _validate_vis_data("comparison", data) is None

    def test_invalid_comparison_visualization_type(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"options": [{"name": "Option A", "visualization": 42}]}
        result = _validate_vis_data("comparison", data)
        assert result is not None
        assert "visualization" in result

    # --- Missing required keys ---

    def test_missing_steps(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("progress-tracker", {}) is not None

    def test_missing_sections(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("summary-box", {}) is not None

    def test_missing_options(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("comparison", {}) is not None

    def test_missing_columns(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("data-table", {"rows": []}) is not None

    def test_missing_items(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("status-list", {}) is not None

    def test_missing_nodes_and_edges(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        assert _validate_vis_data("diagram", {}) is not None

    # --- Invalid sub-fields ---

    def test_step_missing_label(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"steps": [{"status": "done"}]}
        result = _validate_vis_data("progress-tracker", data)
        assert result is not None
        assert "label" in result

    def test_section_missing_items(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"sections": [{"heading": "Title"}]}
        result = _validate_vis_data("summary-box", data)
        assert result is not None
        assert "items" in result

    def test_summary_item_missing_value(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"sections": [{"heading": "T", "items": [{"label": "K"}]}]}
        result = _validate_vis_data("summary-box", data)
        assert result is not None
        assert "value" in result

    def test_option_missing_name(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"options": [{"description": "no name"}]}
        result = _validate_vis_data("comparison", data)
        assert result is not None
        assert "name" in result

    def test_row_length_mismatch(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"columns": ["A", "B"], "rows": [["only-one"]]}
        result = _validate_vis_data("data-table", data)
        assert result is not None
        assert "cells" in result

    def test_node_missing_id(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"nodes": [{"label": "A"}], "edges": []}
        result = _validate_vis_data("diagram", data)
        assert result is not None
        assert "id" in result

    def test_edge_missing_to(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a"}]}
        result = _validate_vis_data("diagram", data)
        assert result is not None
        assert "to" in result

    # --- Invalid status values ---

    def test_invalid_status_progress_tracker(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"steps": [{"label": "Step", "status": "INVALID"}]}
        result = _validate_vis_data("progress-tracker", data)
        assert result is not None
        assert "Valid values" in result

    def test_invalid_status_status_list(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        data = {"items": [{"label": "Item", "status": "NOT_REAL"}]}
        result = _validate_vis_data("status-list", data)
        assert result is not None
        assert "Valid values" in result

    # --- Unknown type ---

    def test_unknown_type(self) -> None:
        from app.agent.tools.visualization import _validate_vis_data

        result = _validate_vis_data("nonexistent-type", {})
        assert result is not None
        assert "Unknown visualization type" in result


# ===========================================================================
# bonsai_visualize handler — integration tests
# ===========================================================================


class TestBonsaiVisualizeHandler:
    async def test_valid_payload_returns_success(self) -> None:
        from app.agent.tools.visualization import _bonsai_visualize

        result = await _bonsai_visualize.handler({
            "type": "progress-tracker",
            "title": "Build",
            "data": {"steps": [{"label": "Compile", "status": "done"}]},
        })
        assert "isError" not in result
        assert "Rendered" in result["content"][0]["text"]

    async def test_invalid_payload_returns_error(self) -> None:
        from app.agent.tools.visualization import _bonsai_visualize

        result = await _bonsai_visualize.handler({
            "type": "summary-box",
            "title": "Bad",
            "data": {"wrong_key": "nope"},
        })
        assert result["isError"] is True
        assert "Validation error" in result["content"][0]["text"]

    async def test_json_string_data_auto_parsed(self) -> None:
        from app.agent.tools.visualization import _bonsai_visualize

        result = await _bonsai_visualize.handler({
            "type": "status-list",
            "title": "Items",
            "data": '{"items": [{"label": "X", "status": "done"}]}',
        })
        assert "isError" not in result
        assert "Rendered" in result["content"][0]["text"]

    async def test_invalid_json_string_data(self) -> None:
        from app.agent.tools.visualization import _bonsai_visualize

        result = await _bonsai_visualize.handler({
            "type": "diagram",
            "title": "Bad",
            "data": "not json at all{{{",
        })
        assert result["isError"] is True
        assert "must be a JSON object, not a string" in result["content"][0]["text"]

    async def test_unknown_type_returns_error(self) -> None:
        from app.agent.tools.visualization import _bonsai_visualize

        result = await _bonsai_visualize.handler({
            "type": "sparkline",
            "title": "Nope",
            "data": {},
        })
        assert result["isError"] is True
        assert "Unknown visualization type" in result["content"][0]["text"]


# ===========================================================================
# vis-server uses shared _vis_validation — integration test
# ===========================================================================


class TestVisServerSharedValidation:
    """Verify vis-server.py imports from the shared _vis_validation module."""

    def test_vis_server_uses_shared_validation(self) -> None:
        """vis-server.py's handle_tool_call catches the same errors as the SDK handler."""
        import importlib
        import sys
        import os

        # Add backend to path (mirroring what vis-server.py does)
        backend_path = os.path.join(os.path.dirname(__file__), "..", "..", "app", "agent", "tools")
        # Import the shared module directly
        from app.agent.tools._vis_validation import _validate_vis_data as shared_validate

        # Also import vis-server to check it uses the same function
        vis_server_dir = os.path.join(os.path.dirname(__file__), "..", "..", "..", "claude-plugin", "tools")
        if os.path.isdir(vis_server_dir):
            sys.path.insert(0, vis_server_dir)
            try:
                # Force fresh import
                if "vis-server" in sys.modules:
                    del sys.modules["vis-server"]
                # Can't use importlib on hyphenated names directly, use spec
                import importlib.util
                spec = importlib.util.spec_from_file_location(
                    "vis_server", os.path.join(vis_server_dir, "vis-server.py")
                )
                if spec and spec.loader:
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    # vis-server's _validate_vis_data should be the same function
                    assert mod._validate_vis_data is shared_validate
            finally:
                sys.path.pop(0)
