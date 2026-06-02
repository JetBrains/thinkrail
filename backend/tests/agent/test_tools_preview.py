"""Tests for the bonsai-preview MCP tools (SetPreviewFile, ClearPreviewFile)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from app.agent.models import AgentConfig
from app.agent.tools._context import set_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / ".bonsai_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


def _make_config(tmp_path: Path) -> AppConfig:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir(exist_ok=True)
    plugin_dir = tmp_path / "plugin"
    plugin_dir.mkdir(exist_ok=True)
    return AppConfig(
        project_root=tmp_path, bonsai_dir=bonsai_dir, plugin_dir=plugin_dir,
    )


async def test_set_preview_file_emits_notification(tmp_path: Path) -> None:
    from app.agent.tools.preview import _set_preview_file

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, _make_config(tmp_path))

    result = await _set_preview_file.handler({
        "path": ".bonsai/design_docs/X.md",
        "section": "Components",
    })

    assert result.get("isError") is not True
    notify.assert_called_once()
    method, payload = notify.call_args.args[:2]
    assert method == "ui/setPreviewFile"
    assert payload["path"] == ".bonsai/design_docs/X.md"
    assert payload["section"] == "Components"
    assert payload["bonsaiSid"] == task.bonsai_sid


async def test_set_preview_file_without_section(tmp_path: Path) -> None:
    from app.agent.tools.preview import _set_preview_file

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, _make_config(tmp_path))

    await _set_preview_file.handler({"path": ".bonsai/design_docs/X.md"})

    payload = notify.call_args.args[1]
    assert "section" not in payload


async def test_set_preview_file_null_path_clears(tmp_path: Path) -> None:
    """path=null is the canonical way to clear the preview. Notifies the
    frontend with path=None and does not error."""
    from app.agent.tools.preview import _set_preview_file

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = "mt_x"
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, _make_config(tmp_path))

    result = await _set_preview_file.handler({"path": None})
    assert result.get("isError") is not True
    notify.assert_called_once()
    method, payload = notify.call_args.args[:2]
    assert method == "ui/setPreviewFile"
    assert payload["path"] is None


async def test_clear_preview_file_emits_notification(tmp_path: Path) -> None:
    """ClearPreviewFile is a deprecated alias — emits ui/setPreviewFile
    with path=None (the canonical clear)."""
    from app.agent.tools.preview import _clear_preview_file

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = "mt_x"
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, _make_config(tmp_path))

    result = await _clear_preview_file.handler({})

    assert result.get("isError") is not True
    notify.assert_called_once()
    method, payload = notify.call_args.args[:2]
    assert method == "ui/setPreviewFile"
    assert payload["bonsaiSid"] == task.bonsai_sid
    assert payload["path"] is None
