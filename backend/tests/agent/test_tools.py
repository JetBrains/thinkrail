"""Tests for the agent tools package — SuggestSession, visualization, specs tools, and tool context."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.models import AgentConfig, AgentTask
from app.agent.tools._context import set_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_config(tmp_path: Path) -> AppConfig:
    """Build an AppConfig rooted in a temp directory."""
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir()
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir()
    return AppConfig(
        project_root=tmp_path,
        bonsai_dir=bonsai_dir,
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
        _write_registry(config.get_registry_path(), ["spec-a"])

        tracker, task = _make_tracker_and_task()
        tracker.set_status(task.bonsai_sid, "idle")
        tracker.set_status(task.bonsai_sid, "running")
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
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(task.bonsai_sid, req_id, {"behavior": "allow"})
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
        assert params["bonsaiSid"] == task.bonsai_sid
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
        tracker.set_status(task.bonsai_sid, "idle")
        tracker.set_status(task.bonsai_sid, "running")
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
            for req_id in list(tracker._futures.get(task.bonsai_sid, {})):
                tracker.resolve_future(task.bonsai_sid, req_id, {"behavior": "deny"})
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
        _write_registry(config.get_registry_path(), ["a"])

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
# Spec & registry MCP tools — helpers
# ===========================================================================


def _write_full_registry(
    path: Path,
    specs: list[dict[str, Any]] | None = None,
    links: list[dict[str, Any]] | None = None,
) -> None:
    """Write a registry.json with full-featured entries."""
    data = {
        "version": "2.0",
        "project": "test",
        "specs": specs or [],
        "links": links or [],
    }
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _make_spec_args(args: dict[str, Any], config: AppConfig) -> dict[str, Any]:
    """Set tool context for spec tool tests and return raw args.

    Previously injected ``_config`` into args (simulating the interceptor).
    Now sets tool context via contextvars — matching the new in-handler pattern.
    """
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


def _setup_registry_with_specs(tmp_path: Path) -> AppConfig:
    """Create a config with a populated registry and spec files on disk."""
    config = _make_config(tmp_path)
    specs = [
        {
            "id": "mod-a",
            "type": "module-design",
            "path": "modules/a/README.md",
            "title": "Module A",
            "status": "active",
            "covers": ["modules/a/"],
            "tags": ["backend"],
            "created": "2026-01-01",
            "updated": "2026-01-01",
        },
        {
            "id": "mod-b",
            "type": "module-design",
            "path": "modules/b/README.md",
            "title": "Module B",
            "status": "draft",
            "covers": ["modules/b/"],
            "tags": ["frontend"],
            "created": "2026-01-02",
            "updated": "2026-01-02",
        },
        {
            "id": "task-1",
            "type": "task-spec",
            "path": "tasks/task_1.md",
            "title": "Task One",
            "status": "active",
            "covers": [],
            "tags": ["high", "backend"],
            "created": "2026-01-03",
            "updated": "2026-01-03",
        },
    ]
    links = [
        {"from": "mod-b", "to": "mod-a", "type": "depends-on"},
        {"from": "task-1", "to": "mod-a", "type": "implements"},
    ]
    _write_full_registry(config.get_registry_path(), specs, links)

    # Create spec files on disk
    for spec in specs:
        file_path = config.get_project_root() / spec["path"]
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(f"# {spec['title']}\n\nSpec content for {spec['id']}.\n")

    return config


# ===========================================================================
# spec_list — tests
# ===========================================================================


class TestSpecList:
    async def test_list_all(self, tmp_path: Path) -> None:
        """No filters → returns all specs."""
        from app.agent.tools.specs import _spec_list

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_list.handler(_make_spec_args({}, config))
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data) == 3

    async def test_filter_by_type(self, tmp_path: Path) -> None:
        """Filter by type → returns only matching specs."""
        from app.agent.tools.specs import _spec_list

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_list.handler(
            _make_spec_args({"type": "module-design"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data) == 2
        assert all(s["type"] == "module-design" for s in data)

    async def test_filter_by_status(self, tmp_path: Path) -> None:
        """Filter by status → returns only matching specs."""
        from app.agent.tools.specs import _spec_list

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_list.handler(
            _make_spec_args({"status": "draft"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data) == 1
        assert data[0]["id"] == "mod-b"

    async def test_filter_by_tag(self, tmp_path: Path) -> None:
        """Filter by tag → returns entries that have the tag."""
        from app.agent.tools.specs import _spec_list

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_list.handler(
            _make_spec_args({"tag": "backend"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data) == 2  # mod-a + task-1

    async def test_no_matches(self, tmp_path: Path) -> None:
        """Filters that match nothing → empty list."""
        from app.agent.tools.specs import _spec_list

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_list.handler(
            _make_spec_args({"status": "deprecated"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data == []


# ===========================================================================
# spec_get — tests
# ===========================================================================


class TestSpecGet:
    async def test_get_valid_id(self, tmp_path: Path) -> None:
        """Valid ID → returns full content + links."""
        from app.agent.tools.specs import _spec_get

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_get.handler(_make_spec_args({"id": "mod-a"}, config))
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["id"] == "mod-a"
        assert data["title"] == "Module A"
        assert "Spec content" in data["content"]
        # mod-a has 2 links (mod-b depends-on it, task-1 implements it)
        assert len(data["links"]) == 2

    async def test_get_missing_id(self, tmp_path: Path) -> None:
        """Unknown ID → isError."""
        from app.agent.tools.specs import _spec_get

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_get.handler(
            _make_spec_args({"id": "nonexistent"}, config)
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_get_missing_param(self, tmp_path: Path) -> None:
        """No id param → isError."""
        from app.agent.tools.specs import _spec_get

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_get.handler(_make_spec_args({}, config))
        _, is_error = _parse_result(result)

        assert is_error


# ===========================================================================
# spec_save — tests
# ===========================================================================


class TestSpecSave:
    async def test_create_new_spec(self, tmp_path: Path) -> None:
        """New path + type → creates file + registry entry."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/c/README.md",
                    "content": "# Module C\n\nNew module.\n",
                    "type": "module-design",
                    "status": "active",
                    "covers": ["modules/c/"],
                    "tags": ["backend"],
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["title"] == "Module C"
        assert data["type"] == "module-design"
        # File exists on disk
        assert (config.get_project_root() / "modules/c/README.md").exists()

    async def test_update_existing_spec(self, tmp_path: Path) -> None:
        """Existing path → updates content."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/a/README.md",
                    "content": "# Module A\n\nUpdated content.\n",
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert "Updated content" in data["content"]

    async def test_create_missing_type(self, tmp_path: Path) -> None:
        """New path without type → isError."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {"path": "new/spec.md", "content": "# New\n"},
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_create_with_explicit_id(self, tmp_path: Path) -> None:
        """Explicit ID → uses that ID instead of auto-generating."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/d/README.md",
                    "content": "# Module D\n\nWith explicit ID.\n",
                    "type": "module-design",
                    "id": "my-custom-id",
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["id"] == "my-custom-id"

    async def test_create_duplicate_id(self, tmp_path: Path) -> None:
        """Duplicate ID → isError."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "somewhere/else.md",
                    "content": "# Conflict\n",
                    "type": "module-design",
                    "id": "mod-a",  # already exists
                },
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_update_with_metadata(self, tmp_path: Path) -> None:
        """Update with status/covers/tags → metadata applied."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/b/README.md",
                    "content": "# Module B\n\nRefreshed.\n",
                    "status": "active",
                    "tags": ["frontend", "updated"],
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        # Verify metadata was applied by re-reading the registry
        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        entry = find_entry(entries, "mod-b")
        assert entry is not None
        assert entry.status == "active"
        assert "updated" in entry.tags

    # --- Registry-sync path (content omitted on updates) ---

    async def test_update_without_content(self, tmp_path: Path) -> None:
        """Existing path + no content → reads from disk, syncs registry metadata."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/b/README.md",
                    "status": "active",
                    "tags": ["frontend", "synced"],
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        # Content should come from the file on disk (not empty)
        assert "Spec content for mod-b" in data["content"]
        # Registry metadata should be updated
        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        entry = find_entry(entries, "mod-b")
        assert entry is not None
        assert entry.status == "active"
        assert "synced" in entry.tags
        # File on disk should be unchanged (not rewritten)
        file_content = (config.get_project_root() / "modules/b/README.md").read_text()
        assert "Spec content for mod-b" in file_content

    async def test_update_without_content_title_sync(self, tmp_path: Path) -> None:
        """Edit file heading on disk, call spec_save without content → title re-derived."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        # Simulate editing the file's heading via Edit tool
        file_path = config.get_project_root() / "modules/a/README.md"
        file_path.write_text("# Module A Revised\n\nUpdated heading.\n")

        result = await _spec_save.handler(
            _make_spec_args(
                {"path": "modules/a/README.md"},
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["title"] == "Module A Revised"
        # Registry entry title should also be updated
        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        entry = find_entry(entries, "mod-a")
        assert entry is not None
        assert entry.title == "Module A Revised"

    async def test_create_without_content_fails(self, tmp_path: Path) -> None:
        """New path + no content → isError (content required for creates)."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/new/README.md",
                    "type": "module-design",
                },
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_update_without_content_missing_file(self, tmp_path: Path) -> None:
        """Entry exists but file missing on disk → isError."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        # Delete the file but keep the registry entry
        file_path = config.get_project_root() / "modules/a/README.md"
        file_path.unlink()

        result = await _spec_save.handler(
            _make_spec_args(
                {"path": "modules/a/README.md", "status": "stale"},
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    # --- Title override ---

    async def test_update_with_title_override(self, tmp_path: Path) -> None:
        """Explicit title → overrides auto-derived heading in registry."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/a/README.md",
                    "content": "# Module A\n\nSame heading.\n",
                    "title": "Custom Registry Title",
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        # Registry title should use the override, not the heading
        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        entry = find_entry(entries, "mod-a")
        assert entry is not None
        assert entry.title == "Custom Registry Title"

    async def test_create_with_title_override(self, tmp_path: Path) -> None:
        """New spec with explicit title → uses override instead of heading."""
        from app.agent.tools.specs import _spec_save

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_save.handler(
            _make_spec_args(
                {
                    "path": "modules/e/README.md",
                    "content": "# Module E Heading\n\nContent.\n",
                    "type": "module-design",
                    "title": "My Custom Title",
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        # ID is auto-generated from the heading, but title should be overridden
        entry = next((e for e in entries if e.path == "modules/e/README.md"), None)
        assert entry is not None
        assert entry.title == "My Custom Title"


# ===========================================================================
# spec_delete — tests
# ===========================================================================


class TestSpecDelete:
    async def test_delete_existing(self, tmp_path: Path) -> None:
        """Delete valid ID → file removed, entry removed, links cleaned."""
        from app.agent.tools.specs import _spec_delete

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_delete.handler(
            _make_spec_args({"id": "mod-a"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert "Deleted" in data
        # File gone
        assert not (config.get_project_root() / "modules/a/README.md").exists()
        # Entry gone from registry
        from app.spec.registry import find_entry, read_registry

        entries, links = read_registry(config.get_registry_path())
        assert find_entry(entries, "mod-a") is None
        # Links referencing mod-a should be cleaned
        mod_a_links = [l for l in links if l.from_id == "mod-a" or l.to_id == "mod-a"]
        assert len(mod_a_links) == 0

    async def test_delete_missing(self, tmp_path: Path) -> None:
        """Unknown ID → isError."""
        from app.agent.tools.specs import _spec_delete

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_delete.handler(
            _make_spec_args({"id": "nonexistent"}, config)
        )
        _, is_error = _parse_result(result)

        assert is_error


# ===========================================================================
# spec_links — tests
# ===========================================================================


class TestSpecLinks:
    async def test_links_for_single_id(self, tmp_path: Path) -> None:
        """Get links for mod-a → returns 2 links + referenced nodes."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-a"]}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["links"]) == 2
        assert len(data["nodes"]) >= 2  # mod-a + at least one other

    async def test_links_filter_by_type(self, tmp_path: Path) -> None:
        """Filter by link_type → only matching links."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-a"], "link_type": "depends-on"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["links"]) == 1
        assert data["links"][0]["type"] == "depends-on"

    async def test_links_filter_direction_incoming(self, tmp_path: Path) -> None:
        """direction=incoming for mod-a → links where mod-a is 'to'."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-a"], "direction": "incoming"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        # Both links have mod-a as target
        for lnk in data["links"]:
            assert lnk["to"] == "mod-a"

    async def test_links_filter_direction_outgoing(self, tmp_path: Path) -> None:
        """direction=outgoing for mod-b → links where mod-b is 'from'."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-b"], "direction": "outgoing"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["links"]) == 1
        assert data["links"][0]["from"] == "mod-b"

    async def test_links_unknown_id(self, tmp_path: Path) -> None:
        """Unknown ID → isError."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["nonexistent"]}, config)
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_links_multiple_ids(self, tmp_path: Path) -> None:
        """Multiple IDs → union of their links."""
        from app.agent.tools.specs import _spec_links

        config = _setup_registry_with_specs(tmp_path)
        result = await _spec_links.handler(
            _make_spec_args({"ids": ["mod-a", "mod-b"]}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["links"]) == 2  # depends-on + implements


# ===========================================================================
# registry_query — tests
# ===========================================================================


class TestRegistryQuery:
    async def test_query_all(self, tmp_path: Path) -> None:
        """No filters → all entries."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(_make_spec_args({}, config))
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["entries"]) == 3

    async def test_query_by_type(self, tmp_path: Path) -> None:
        """Filter by type."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(
            _make_spec_args({"type": "task-spec"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["entries"]) == 1
        assert data["entries"][0]["id"] == "task-1"

    async def test_query_by_covers(self, tmp_path: Path) -> None:
        """Filter by covers prefix."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(
            _make_spec_args({"covers": "modules/a/"}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["entries"]) == 1
        assert data["entries"][0]["id"] == "mod-a"

    async def test_query_by_ids(self, tmp_path: Path) -> None:
        """Filter by specific IDs."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(
            _make_spec_args({"ids": ["mod-a", "task-1"]}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert len(data["entries"]) == 2

    async def test_query_include_links(self, tmp_path: Path) -> None:
        """include_links=true → links included in response."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(
            _make_spec_args({"ids": ["mod-a"], "include_links": True}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert "links" in data
        assert len(data["links"]) == 2

    async def test_query_no_links_by_default(self, tmp_path: Path) -> None:
        """include_links not set → no links key in response."""
        from app.agent.tools.specs import _registry_query

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_query.handler(_make_spec_args({}, config))
        data, _ = _parse_result(result)

        assert "links" not in data


# ===========================================================================
# registry_mutate — tests
# ===========================================================================


class TestRegistryMutate:
    async def test_add_entries_and_links(self, tmp_path: Path) -> None:
        """Batch add → entries and links created, counts returned."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {
                    "add_entries": [
                        {
                            "id": "mod-c",
                            "type": "module-design",
                            "path": "modules/c/README.md",
                            "title": "Module C",
                        }
                    ],
                    "add_links": [
                        {"from": "mod-c", "to": "mod-a", "type": "parent"},
                    ],
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["entries_added"] == 1
        assert data["links_added"] == 1

        # Verify persisted
        from app.spec.registry import find_entry, read_registry

        entries, links = read_registry(config.get_registry_path())
        assert find_entry(entries, "mod-c") is not None
        parent_links = [l for l in links if l.from_id == "mod-c" and l.type == "parent"]
        assert len(parent_links) == 1

    async def test_remove_entries(self, tmp_path: Path) -> None:
        """Remove entry → entry + its links cleaned."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args({"remove_entries": ["mod-b"]}, config)
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["entries_removed"] == 1

        from app.spec.registry import find_entry, read_registry

        entries, links = read_registry(config.get_registry_path())
        assert find_entry(entries, "mod-b") is None
        # The depends-on link from mod-b should be gone
        mod_b_links = [l for l in links if l.from_id == "mod-b" or l.to_id == "mod-b"]
        assert len(mod_b_links) == 0

    async def test_update_entries(self, tmp_path: Path) -> None:
        """Update entry → only specified fields change."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {
                    "update_entries": [
                        {"id": "mod-a", "status": "stale", "tags": ["backend", "needs-review"]},
                    ]
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["entries_updated"] == 1

        from app.spec.registry import find_entry, read_registry

        entries, _ = read_registry(config.get_registry_path())
        entry = find_entry(entries, "mod-a")
        assert entry is not None
        assert entry.status == "stale"
        assert "needs-review" in entry.tags
        # Path should be unchanged
        assert entry.path == "modules/a/README.md"

    async def test_validation_rejects_broken_links(self, tmp_path: Path) -> None:
        """Adding a link to a nonexistent target → isError, nothing written."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {
                    "add_links": [
                        {"from": "mod-a", "to": "nonexistent", "type": "parent"},
                    ],
                },
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

        # Registry unchanged
        from app.spec.registry import read_registry

        _, links = read_registry(config.get_registry_path())
        assert len(links) == 2  # Original count

    async def test_validation_rejects_self_link(self, tmp_path: Path) -> None:
        """Self-link → isError."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {
                    "add_links": [
                        {"from": "mod-a", "to": "mod-a", "type": "parent"},
                    ],
                },
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_update_nonexistent_entry(self, tmp_path: Path) -> None:
        """Updating a nonexistent entry → isError."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {"update_entries": [{"id": "ghost", "status": "active"}]},
                config,
            )
        )
        _, is_error = _parse_result(result)

        assert is_error

    async def test_remove_then_add_same_path(self, tmp_path: Path) -> None:
        """Remove then add in same batch → no conflict (removals first)."""
        from app.agent.tools.specs import _registry_mutate

        config = _setup_registry_with_specs(tmp_path)
        result = await _registry_mutate.handler(
            _make_spec_args(
                {
                    "remove_entries": ["mod-b"],
                    "add_entries": [
                        {
                            "id": "mod-b-v2",
                            "type": "module-design",
                            "path": "modules/b/README.md",
                            "title": "Module B v2",
                        }
                    ],
                },
                config,
            )
        )
        data, is_error = _parse_result(result)

        assert not is_error
        assert data["entries_removed"] == 1
        assert data["entries_added"] == 1


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
