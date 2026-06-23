"""Tests for the PostToolUse change-log hook."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.agent.models import AgentConfig
from app.agent.tracker import Tracker
from app.core.config import AppConfig


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_dir = tmp_path / ".thinkrail_server"
    data_dir.mkdir()
    monkeypatch.setattr("app.core.config.get_data_dir", lambda: data_dir)


def _config(tmp_path: Path) -> AppConfig:
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
    return AppConfig(project_root=tmp_path, thinkrail_dir=thinkrail_dir, plugin_dir=tmp_path)


def _ticket_task(tracker: Tracker, ticket_id: str, skill_id: str | None = None):
    task = tracker.create_task([], AgentConfig())
    task.ticket_id = ticket_id
    task.skill_id = skill_id
    return task


class TestChangeLogHook:
    async def test_logs_spec_edit_and_autolinks(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook
        from app.board.service import BoardService

        config = _config(tmp_path)
        (tmp_path / ".tr" / "design_docs").mkdir(parents=True)
        spec = tmp_path / ".tr" / "design_docs" / "X.md"
        spec.write_text("---\nid: spec_x\n---\n\n## Components\nFoo and bar.\n")
        svc = BoardService(config)
        ticket = svc.create_ticket(title="T")

        tracker = Tracker()
        task = _ticket_task(tracker, ticket.id, "ticket-amend-specs")
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use(
            {"tool_name": "Edit", "tool_input": {
                "file_path": ".tr/design_docs/X.md",
                "old_string": "Foo.", "new_string": "Foo and bar."}},
            "tool-1", None,
        )

        log = (tmp_path / ".tr" / "tickets" / ticket.id / "history.patch").read_text()
        assert "# == amendment 1 ==" in log
        assert "# spec_id:    spec_x" in log
        assert "# skill:      ticket-amend-specs" in log
        assert "-Foo." in log and "+Foo and bar." in log
        assert "spec_x" in svc.get_ticket(ticket.id).linked_spec_ids

    async def test_logs_source_edit_without_spec_id(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook
        from app.board.service import BoardService

        config = _config(tmp_path)
        (tmp_path / "src.py").write_text("print('bye')\n")
        svc = BoardService(config)
        ticket = svc.create_ticket(title="T")
        tracker = Tracker()
        task = _ticket_task(tracker, ticket.id)
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use(
            {"tool_name": "Edit", "tool_input": {
                "file_path": "src.py", "old_string": "hi", "new_string": "bye"}},
            "t", None,
        )

        log = (tmp_path / ".tr" / "tickets" / ticket.id / "history.patch").read_text()
        assert "# == amendment 1 ==" in log
        assert "src.py" in log
        assert "# spec_id:    (none)" in log

    async def test_no_ticket_no_log(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook

        config = _config(tmp_path)
        tracker = Tracker()
        task = tracker.create_task([], AgentConfig())  # no ticket_id
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use(
            {"tool_name": "Edit", "tool_input": {
                "file_path": "src.py", "old_string": "a", "new_string": "b"}},
            "t", None,
        )
        assert list((tmp_path / ".tr").rglob("history.patch")) == []

    async def test_write_records_create_patch_and_bookkeeping(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook
        from app.board.service import BoardService

        config = _config(tmp_path)
        svc = BoardService(config)
        ticket = svc.create_ticket(title="T")
        f = tmp_path / ".tr" / "tickets" / ticket.id / "product-design.md"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("# PD\n\nbody\n")
        tracker = Tracker()
        task = _ticket_task(tracker, ticket.id)
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use(
            {"tool_name": "Write", "tool_input": {
                "file_path": f".tr/tickets/{ticket.id}/product-design.md",
                "content": "# PD\n\nbody\n"}},
            "t", None,
        )

        log = (tmp_path / ".tr" / "tickets" / ticket.id / "history.patch").read_text()
        assert "# == amendment 1 ==" in log
        assert "+# PD" in log
        assert svc.get_ticket(ticket.id).product_design_path == f".tr/tickets/{ticket.id}/product-design.md"

    async def test_ignores_unhandled_tool(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook
        from app.board.service import BoardService

        config = _config(tmp_path)
        svc = BoardService(config)
        ticket = svc.create_ticket(title="T")
        tracker = Tracker()
        task = _ticket_task(tracker, ticket.id)
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use({"tool_name": "Read", "tool_input": {"file_path": "x"}}, "t", None)
        assert list((tmp_path / ".tr").rglob("history.patch")) == []

    async def test_ignores_path_outside_project_root(self, tmp_path: Path) -> None:
        from app.agent.runtime.claude.change_log_hook import ChangeLogHook
        from app.board.service import BoardService

        config = _config(tmp_path)
        svc = BoardService(config)
        ticket = svc.create_ticket(title="T")
        tracker = Tracker()
        task = _ticket_task(tracker, ticket.id)
        hook = ChangeLogHook(task, config)

        await hook.post_tool_use(
            {"tool_name": "Edit", "tool_input": {
                "file_path": "../escape.md", "old_string": "a", "new_string": "b"}},
            "t", None,
        )
        assert list((tmp_path / ".tr").rglob("history.patch")) == []
