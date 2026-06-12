"""Tests for the agent tools package — SuggestSession, visualization, specs tools, and tool context."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.models import AgentConfig, AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import set_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig, get_index_path


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Route get_data_dir() to a temp directory so index paths stay isolated."""
    data_dir = tmp_path / ".thinkrail_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(tmp_path: Path) -> AppConfig:
    """Build an AppConfig rooted in a temp directory."""
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir(exist_ok=True)
    return AppConfig(
        project_root=tmp_path,
        thinkrail_dir=thinkrail_dir,
        plugin_dir=plugin_dir,
    )


def _make_tracker_and_task() -> tuple[Tracker, AgentTask]:
    """Create a Tracker with a task in idle state."""
    tracker = Tracker()
    task = tracker.create_task(["spec-1"], AgentConfig())
    return tracker, task


async def _write_index(project_root: Path, spec_ids: list[str]) -> None:
    """Write a minimal index.db with the given spec IDs.

    Uses ``get_index_path`` to compute the external index path,
    consistent with production code.
    """
    from app.spec.index import SpecIndex
    from app.spec.models import SpecEntry

    db_path = get_index_path(project_root)
    async with SpecIndex(db_path) as index:
        for sid in spec_ids:
            entry = SpecEntry(
                id=sid, type="module-design", path=f"/{sid}",
                title=sid, status="active", content_hash="", indexed_at="",
            )
            await index.upsert_spec(entry)


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
    async def test_validate_spec_ids_empty_list(self, tmp_path: Path) -> None:
        """Empty list → short-circuit, returns None."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        # Path doesn't even need to exist — empty list short-circuits
        assert await _validate_spec_ids([], tmp_path) is None

    async def test_validate_spec_ids_all_valid(self, tmp_path: Path) -> None:
        """All IDs present in index → returns None."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        await _write_index(tmp_path, ["a", "b"])
        assert await _validate_spec_ids(["a", "b"], tmp_path) is None

    async def test_validate_spec_ids_some_missing(self, tmp_path: Path) -> None:
        """Some IDs missing → returns error naming the missing ones."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        await _write_index(tmp_path, ["a"])
        result = await _validate_spec_ids(["a", "b"], tmp_path)
        assert result is not None
        assert "Unknown specIds: b" in result

    async def test_validate_spec_ids_missing_index(self, tmp_path: Path) -> None:
        """Non-existent index → returns error."""
        from app.agent.tools.suggest_session import _validate_spec_ids

        # Use a fresh project root that has never had an index built
        fake_project = tmp_path / "no_index_project"
        fake_project.mkdir()
        result = await _validate_spec_ids(["x"], fake_project)
        assert result is not None
        assert "index not found" in result


# ===========================================================================
# _suggest_session handler — in-handler interaction tests
# ===========================================================================


class TestSuggestSessionInHandlerInteraction:
    async def test_handler_approve_flow(self, tmp_path: Path) -> None:
        """Approve → result contains 'approved and created'."""
        from app.agent.tools.suggest_session import _suggest_session

        config = _make_config(tmp_path)
        skill_dir = config.plugin_dir / "skills" / "module-design"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")
        await _write_index(config.get_project_root(), ["spec-a"])

        tracker, task = _make_tracker_and_task()
        tracker.set_status(task.thinkrail_sid, "idle")
        tracker.set_status(task.thinkrail_sid, "running")
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        args = {
            "skill": "module-design",
            "specIds": ["spec-a"],
            "name": "Design: Agent Module",
            "reason": "Needs its own spec.",
        }

        async def resolve_approve():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(task.thinkrail_sid, req_id, {"behavior": "allow"})
                break

        asyncio.get_event_loop().create_task(resolve_approve())

        result = await _suggest_session.handler(args)
        text = result["content"][0]["text"]
        assert "approved and created" in text
        assert "Design: Agent Module" in text

        # Verify notify was called with the right method and params
        notify.assert_called_once()
        call_args = notify.call_args
        assert call_args.args[0] == "agent/suggestSession"
        params = call_args.args[1]
        assert params["thinkrailSid"] == task.thinkrail_sid
        assert params["skill"] == "module-design"
        assert params["specIds"] == ["spec-a"]

    async def test_handler_dismiss_flow(self, tmp_path: Path) -> None:
        """Dismiss → result contains 'dismissed'."""
        from app.agent.tools.suggest_session import _suggest_session

        config = _make_config(tmp_path)
        skill_dir = config.plugin_dir / "skills" / "task-spec"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")

        tracker, task = _make_tracker_and_task()
        tracker.set_status(task.thinkrail_sid, "idle")
        tracker.set_status(task.thinkrail_sid, "running")
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        args = {
            "skill": "task-spec",
            "specIds": [],
            "name": "Some Task",
            "reason": "Because.",
        }

        async def resolve_deny():
            await asyncio.sleep(0.01)
            for req_id in list(tracker._futures.get(task.thinkrail_sid, {})):
                tracker.resolve_future(task.thinkrail_sid, req_id, {"behavior": "deny"})
                break

        asyncio.get_event_loop().create_task(resolve_deny())

        result = await _suggest_session.handler(args)
        text = result["content"][0]["text"]
        assert "dismissed" in text.lower()

    async def test_handler_validation_failure_bad_skill(self, tmp_path: Path) -> None:
        """Invalid skill → returns isError with error message."""
        from app.agent.tools.suggest_session import _suggest_session

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        args = {
            "skill": "nonexistent-skill",
            "specIds": [],
            "name": "Bad Skill",
            "reason": "Testing.",
        }

        result = await _suggest_session.handler(args)

        assert result.get("isError") is True
        text = result["content"][0]["text"]
        assert "Unknown skill: nonexistent-skill" in text
        notify.assert_not_called()

    async def test_handler_validation_failure_bad_spec_id(self, tmp_path: Path) -> None:
        """Valid skill but invalid specId → returns isError with error."""
        from app.agent.tools.suggest_session import _suggest_session

        config = _make_config(tmp_path)
        skill_dir = config.plugin_dir / "skills" / "module-design"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("# skill")
        await _write_index(config.get_project_root(), ["a"])

        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        set_tool_context(tracker, notify, task, config)

        args = {
            "skill": "module-design",
            "specIds": ["a", "missing-spec"],
            "name": "Bad Spec",
            "reason": "Testing.",
        }

        result = await _suggest_session.handler(args)

        assert result.get("isError") is True
        text = result["content"][0]["text"]
        assert "Unknown specIds: missing-spec" in text
        notify.assert_not_called()




# ===========================================================================
# Spec MCP tools — helpers (3 tools: spec_search, spec_links, spec_delete)
# ===========================================================================


def _make_spec_args(args: dict[str, Any], config: AppConfig) -> dict[str, Any]:
    """Set tool context for spec tool tests and return raw args."""
    tracker = Tracker()
    task = tracker.create_task(["spec-test"], AgentConfig())
    set_tool_context(tracker, AsyncMock(), task, config)
    return args


def _parse_result(result: dict) -> tuple[Any, bool]:
    """Extract parsed JSON data and isError flag from MCP tool result."""
    text = result["content"][0]["text"]
    is_error = result.get("isError", False)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = text
    return data, is_error


async def _setup_index_with_specs(tmp_path: Path) -> AppConfig:
    """Create a config with frontmatter spec files and a SQLite index."""
    from app.spec.frontmatter import serialize_frontmatter
    from app.spec.index import SpecIndex

    config = _make_config(tmp_path)
    specs = [
        {
            "id": "mod-a", "type": "module-design",
            "path": "modules/a/README.md", "title": "Module A",
            "status": "active", "covers": ["modules/a/"], "tags": ["backend"],
        },
        {
            "id": "mod-b", "type": "module-design",
            "path": "modules/b/README.md", "title": "Module B",
            "status": "draft", "covers": ["modules/b/"], "tags": ["frontend"],
        },
        {
            "id": "task-1", "type": "task-spec",
            "path": "tasks/task_1.md", "title": "Task One",
            "status": "active", "covers": [], "tags": ["high", "backend"],
        },
    ]

    # Create spec files with frontmatter
    for spec in specs:
        meta = {
            "id": spec["id"], "type": spec["type"], "status": spec["status"],
            "title": spec["title"],
        }
        if spec.get("covers"):
            meta["covers"] = spec["covers"]
        if spec.get("tags"):
            meta["tags"] = spec["tags"]
        # Add link fields for the known links
        if spec["id"] == "mod-b":
            meta["depends-on"] = ["mod-a"]
        elif spec["id"] == "task-1":
            meta["implements"] = ["mod-a"]

        body = f"# {spec['title']}\n\nSpec content for {spec['id']}.\n"
        content = serialize_frontmatter(meta, body)
        file_path = config.get_project_root() / spec["path"]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")

    # Build index from disk (uses external path via get_index_path)
    db_path = get_index_path(config.get_project_root())
    async with SpecIndex(db_path) as index:
        await index.rebuild(config.get_project_root())

    return config


# ===========================================================================
# spec_search — tests
# ===========================================================================


class TestSpecSearch:
    async def test_search_all(self, tmp_path: Path) -> None:
        """No filters → returns all specs."""
        from app.agent.tools.specs import _spec_search

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_search.handler(_make_spec_args({}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data) == 3

    async def test_search_by_type(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_search

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_search.handler(_make_spec_args({"type": "task-spec"}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data) == 1
        assert data[0]["id"] == "task-1"

    async def test_search_by_status(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_search

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_search.handler(_make_spec_args({"status": "active"}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data) == 2

    async def test_search_by_tag(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_search

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_search.handler(_make_spec_args({"tag": "backend"}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data) == 2
        ids = {d["id"] for d in data}
        assert "mod-a" in ids
        assert "task-1" in ids

    async def test_search_returns_expected_fields(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_search

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_search.handler(_make_spec_args({}, config))
        data, _ = _parse_result(result)
        entry = data[0]
        assert "id" in entry
        assert "path" in entry
        assert "title" in entry
        assert "type" in entry
        assert "status" in entry
        assert "tags" in entry


# ===========================================================================
# spec_links — tests
# ===========================================================================


class TestSpecLinks:
    async def test_links_all_for_spec(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_links

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_links.handler(_make_spec_args({"ids": ["mod-a"]}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data["links"]) == 2  # mod-b→mod-a, task-1→mod-a

    async def test_links_missing_ids_returns_error(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_links

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_links.handler(_make_spec_args({"ids": []}, config))
        _, is_error = _parse_result(result)
        assert is_error

    async def test_links_unknown_id_returns_error(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_links

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_links.handler(_make_spec_args({"ids": ["nonexistent"]}, config))
        _, is_error = _parse_result(result)
        assert is_error

    async def test_links_with_type_filter(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_links

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-a"], "link_type": "depends-on"}, config)
        )
        data, is_error = _parse_result(result)
        assert not is_error
        assert len(data["links"]) == 1
        assert data["links"][0]["type"] == "depends-on"

    async def test_links_returns_nodes(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_links

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_links.handler(_make_spec_args({"ids": ["mod-a"]}, config))
        data, _ = _parse_result(result)
        assert len(data["nodes"]) > 0
        node_ids = {n["id"] for n in data["nodes"]}
        assert "mod-a" in node_ids


# ===========================================================================
# spec_delete — tests
# ===========================================================================


class TestSpecDelete:
    async def test_delete_spec(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_delete

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_delete.handler(_make_spec_args({"id": "mod-b"}, config))
        data, is_error = _parse_result(result)
        assert not is_error
        assert "Deleted" in data

    async def test_delete_not_found(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_delete

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_delete.handler(_make_spec_args({"id": "ghost"}, config))
        _, is_error = _parse_result(result)
        assert is_error

    async def test_delete_missing_id(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import _spec_delete

        config = await _setup_index_with_specs(tmp_path)
        result = await _spec_delete.handler(_make_spec_args({"id": ""}, config))
        _, is_error = _parse_result(result)
        assert is_error


# ===========================================================================
# _index_service caching — cached vs fallback path
# ===========================================================================


class TestIndexServiceCaching:
    async def test_yields_cached_spec_service_when_set(self, tmp_path: Path) -> None:
        """When ToolContext has spec_service, _index_service() yields it directly."""
        from app.agent.tools.specs import _index_service

        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        mock_service = MagicMock()  # stand-in for SpecService
        set_tool_context(tracker, AsyncMock(), task, config, spec_service=mock_service)

        async with _index_service() as svc:
            assert svc is mock_service  # same object, no fresh connection

    async def test_falls_back_to_fresh_connection_when_no_service(self, tmp_path: Path) -> None:
        """When spec_service is None, _index_service() opens a fresh SpecIndex."""
        from app.agent.tools.specs import _index_service

        config = await _setup_index_with_specs(tmp_path)
        _make_spec_args({}, config)  # sets context with spec_service=None

        async with _index_service() as svc:
            assert svc is not None
            # Verify it can actually query (fresh connection works)
            results = await svc.list_specs()
            assert len(results) == 3  # from _setup_index_with_specs


# ===========================================================================
# Tool registration — verify 3 tools registered
# ===========================================================================


class TestToolRegistration:
    def test_only_three_tools_registered(self) -> None:
        from app.agent.tools.specs import _spec_delete, _spec_links, _spec_search, specs_mcp_server
        # Verify server name and that all three tool handlers are callable
        assert specs_mcp_server["name"] == "thinkrail-specs"
        assert all(hasattr(t, "handler") for t in [_spec_search, _spec_links, _spec_delete])

    def test_old_tools_not_registered(self) -> None:
        from app.agent.tools import INTERCEPTORS
        old_names = {"spec_list", "spec_get", "spec_save", "registry_query", "registry_mutate"}
        registered = set(INTERCEPTORS.keys())
        assert old_names.isdisjoint(registered), f"Old tools still registered: {old_names & registered}"

    def test_new_tools_registered(self) -> None:
        from app.agent.tools import INTERCEPTORS
        assert "spec_search" in INTERCEPTORS
        assert "spec_links" in INTERCEPTORS
        assert "spec_delete" in INTERCEPTORS


# (Old spec tool tests for spec_list, spec_get, spec_save, registry_query,
# registry_mutate removed — those tools no longer exist.)


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
# thinkrail_visualize handler — integration tests
# ===========================================================================


class TestThinkRailVisualizeHandler:
    async def test_valid_payload_returns_success(self) -> None:
        from app.agent.tools.visualization import _thinkrail_visualize

        result = await _thinkrail_visualize.handler({
            "type": "progress-tracker",
            "title": "Build",
            "data": {"steps": [{"label": "Compile", "status": "done"}]},
        })
        assert "isError" not in result
        assert "Rendered" in result["content"][0]["text"]

    async def test_invalid_payload_returns_error(self) -> None:
        from app.agent.tools.visualization import _thinkrail_visualize

        result = await _thinkrail_visualize.handler({
            "type": "summary-box",
            "title": "Bad",
            "data": {"wrong_key": "nope"},
        })
        assert result["isError"] is True
        assert "Validation error" in result["content"][0]["text"]

    async def test_json_string_data_auto_parsed(self) -> None:
        from app.agent.tools.visualization import _thinkrail_visualize

        result = await _thinkrail_visualize.handler({
            "type": "status-list",
            "title": "Items",
            "data": '{"items": [{"label": "X", "status": "done"}]}',
        })
        assert "isError" not in result
        assert "Rendered" in result["content"][0]["text"]

    async def test_invalid_json_string_data(self) -> None:
        from app.agent.tools.visualization import _thinkrail_visualize

        result = await _thinkrail_visualize.handler({
            "type": "diagram",
            "title": "Bad",
            "data": "not json at all{{{",
        })
        assert result["isError"] is True
        assert "must be a JSON object, not a string" in result["content"][0]["text"]

    async def test_unknown_type_returns_error(self) -> None:
        from app.agent.tools.visualization import _thinkrail_visualize

        result = await _thinkrail_visualize.handler({
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


# ===========================================================================
# Interceptors return runtime-neutral ToolPermissionResponse — Task 7
# ===========================================================================


class TestInterceptorsReturnNeutralResponse:
    """Each interceptor must auto-approve via ``ToolPermissionResponse``,
    not Claude SDK ``PermissionResultAllow``. This is what makes the
    runtime-neutral contract real — the dispatch in ``can_use_tool``
    returns the interceptor result unchanged.
    """

    async def _invoke(
        self, intercept_fn, tmp_path: Path,
    ) -> ToolPermissionResponse:
        config = _make_config(tmp_path)
        tracker, task = _make_tracker_and_task()
        notify = AsyncMock()
        return await intercept_fn({}, tracker, notify, task, config)

    async def test_intercept_specs_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.specs import intercept_specs

        result = await self._invoke(intercept_specs, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    async def test_intercept_visualize_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.visualization import intercept_visualize

        result = await self._invoke(intercept_visualize, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    async def test_intercept_suggest_session_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.suggest_session import intercept_suggest_session

        result = await self._invoke(intercept_suggest_session, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    async def test_intercept_suggest_description_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.suggest_description import intercept_suggest_description

        result = await self._invoke(intercept_suggest_description, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    async def test_intercept_orchestrator_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.orchestrator import intercept_orchestrator

        result = await self._invoke(intercept_orchestrator, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    async def test_intercept_change_ticket_status_returns_neutral_allow(self, tmp_path: Path) -> None:
        from app.agent.tools.change_ticket_status import intercept_change_ticket_status

        result = await self._invoke(intercept_change_ticket_status, tmp_path)
        assert isinstance(result, ToolPermissionResponse)
        assert result.behavior == "allow"

    def test_no_claude_sdk_permission_imports_in_tools_package(self) -> None:
        """The whole point of Task 7: interceptor modules must not
        reference Claude SDK permission types. Walk each module's AST
        so doc-string mentions don't fool the check.
        """
        import ast

        from app.agent.tools import (
            change_ticket_status as ct_mod,
            orchestrator as orch_mod,
            specs as specs_mod,
            suggest_description as sd_mod,
            suggest_session as ss_mod,
            visualization as vis_mod,
        )

        modules = [ct_mod, orch_mod, specs_mod, sd_mod, ss_mod, vis_mod]
        forbidden = {"PermissionResultAllow", "PermissionResultDeny"}
        for mod in modules:
            tree = ast.parse(open(mod.__file__).read())
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        assert alias.name not in forbidden, (
                            f"{mod.__name__} still imports {alias.name} "
                            f"from {node.module}"
                        )
