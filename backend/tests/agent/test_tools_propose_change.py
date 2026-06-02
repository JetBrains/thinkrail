"""Tests for the bonsai-amend MCP tool (ProposeChange)."""

from __future__ import annotations

import asyncio
import json
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


def _make_ticket(svc, title: str = "T"):
    return svc.create_ticket(title=title, status="amend-specs")


async def _resolve_pending(tracker: Tracker, bonsai_sid: str, response: dict) -> None:
    """Resolve whichever future is currently pending."""
    await asyncio.sleep(0.01)
    for req_id in list(tracker._futures.get(bonsai_sid, {})):
        tracker.resolve_future(bonsai_sid, req_id, response)
        break


async def test_propose_change_accept_applies_and_logs(tmp_path: Path) -> None:
    from app.agent.tools.propose_change import _propose_change
    from app.board.service import BoardService

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("---\nid: spec_x\n---\n\n## Components\nFoo.\n")

    svc = BoardService(config)
    ticket = _make_ticket(svc)

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = ticket.id
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    asyncio.get_event_loop().create_task(_resolve_pending(
        tracker, task.bonsai_sid,
        {"behavior": "allow", "applied": "original"},
    ))

    result = await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "Foo.",
        "new_string": "Foo and bar.",
        "section": "Components",
        "rationale": "add bar",
    })

    # File was amended
    assert "Foo and bar." in spec.read_text()
    # Log was written
    log = (tmp_path / ".bonsai" / "tickets" / ticket.id / "history.patch").read_text()
    assert "# == amendment 1 ==" in log
    assert "# spec_id:    spec_x" in log
    assert "# applied_as: original" in log
    # Notification was sent
    method, payload = notify.call_args_list[0].args[:2]
    assert method == "agent/proposeChange"
    assert payload["filePath"] == ".bonsai/design_docs/X.md"
    # Tool result JSON
    text = result["content"][0]["text"]
    body = json.loads(text)
    assert body["applied"] == "original"
    assert body["validation"] == "ok"
    # Auto-link
    refreshed = svc.get_ticket(ticket.id)
    assert "spec_x" in refreshed.linked_spec_ids


async def test_propose_change_edit_applies_user_text(tmp_path: Path) -> None:
    from app.agent.tools.propose_change import _propose_change
    from app.board.service import BoardService

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("Foo.\n")

    svc = BoardService(config)
    ticket = _make_ticket(svc)

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = ticket.id
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    asyncio.get_event_loop().create_task(_resolve_pending(
        tracker, task.bonsai_sid,
        {"behavior": "allow", "applied": "edited",
         "edited_new_string": "Foo, baz, and qux.\n"},
    ))

    await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "Foo.\n",
        "new_string": "Foo and bar.\n",
    })

    assert spec.read_text() == "Foo, baz, and qux.\n"
    log = (tmp_path / ".bonsai" / "tickets" / ticket.id / "history.patch").read_text()
    assert "# applied_as: edited" in log


async def test_propose_change_discuss_no_apply(tmp_path: Path) -> None:
    from app.agent.tools.propose_change import _propose_change
    from app.board.service import BoardService

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("Foo.\n")

    svc = BoardService(config)
    ticket = _make_ticket(svc)

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = ticket.id
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    asyncio.get_event_loop().create_task(_resolve_pending(
        tracker, task.bonsai_sid,
        {"behavior": "deny", "discuss": True, "feedback": "make it bigger"},
    ))

    result = await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "Foo.\n",
        "new_string": "Foo and bar.\n",
    })

    # File unchanged
    assert spec.read_text() == "Foo.\n"
    # No log
    log_path = tmp_path / ".bonsai" / "tickets" / ticket.id / "history.patch"
    assert not log_path.exists()
    # Tool result reflects deny
    body = json.loads(result["content"][0]["text"])
    assert body["behavior"] == "deny"
    assert body["discuss"] is True
    assert body["feedback"] == "make it bigger"


async def test_propose_change_reject_no_apply(tmp_path: Path) -> None:
    from app.agent.tools.propose_change import _propose_change
    from app.board.service import BoardService

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("Foo.\n")

    svc = BoardService(config)
    ticket = _make_ticket(svc)

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = ticket.id
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    asyncio.get_event_loop().create_task(_resolve_pending(
        tracker, task.bonsai_sid,
        {"behavior": "deny", "discuss": False, "reason": "wrong file"},
    ))

    result = await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "Foo.\n",
        "new_string": "Foo and bar.\n",
    })

    assert spec.read_text() == "Foo.\n"
    body = json.loads(result["content"][0]["text"])
    assert body["behavior"] == "deny"
    assert body["discuss"] is False


async def test_propose_change_non_unique_old_string_returns_error(tmp_path: Path) -> None:
    from app.agent.tools.propose_change import _propose_change

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("dup\nmid\ndup\n")

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    result = await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "dup",
        "new_string": "new",
    })

    assert result.get("isError") is True
    notify.assert_not_called()


async def test_propose_change_non_ticket_session_skips_log_and_link(tmp_path: Path) -> None:
    """No ticket_id → apply + validate, but no .patch log and no auto-link."""
    from app.agent.tools.propose_change import _propose_change

    config = _make_config(tmp_path)
    (tmp_path / ".bonsai" / "design_docs").mkdir(parents=True)
    spec = tmp_path / ".bonsai" / "design_docs" / "X.md"
    spec.write_text("---\nid: spec_x\n---\n\nFoo.\n")

    tracker = Tracker()
    task = tracker.create_task([], AgentConfig())
    # task.ticket_id intentionally not set
    notify = AsyncMock()
    set_tool_context(tracker, notify, task, config)

    asyncio.get_event_loop().create_task(_resolve_pending(
        tracker, task.bonsai_sid,
        {"behavior": "allow", "applied": "original"},
    ))

    result = await _propose_change.handler({
        "file_path": ".bonsai/design_docs/X.md",
        "old_string": "Foo.",
        "new_string": "Foo and bar.",
    })

    assert "Foo and bar." in spec.read_text()
    body = json.loads(result["content"][0]["text"])
    assert body["applied"] == "original"
    # No .patch log was created
    log_paths = list((tmp_path / ".bonsai").rglob("history.patch"))
    assert log_paths == []
