"""Integration test: trash a session that's attached to tickets, then restore it."""

import json
from pathlib import Path

from app.board.service import BoardService
from app.core.config import load_config
from app.trash.service import TrashService


def _setup(tmp_path: Path) -> tuple[BoardService, TrashService]:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir()
    reg = {"version": "2.0", "project": "test", "specs": [], "links": []}
    (bonsai_dir / "registry.json").write_text(json.dumps(reg), encoding="utf-8")

    sessions_dir = bonsai_dir / "sessions"
    sessions_dir.mkdir()

    config = load_config(tmp_path)
    board = BoardService(config)
    trash = TrashService(project_root=tmp_path)
    return board, trash


class TestSessionTrashIntegration:
    def test_detach_then_trash_then_restore(self, tmp_path: Path) -> None:
        board, trash = _setup(tmp_path)

        # Create session files
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        (sessions_dir / "s1.json").write_text(json.dumps({
            "bonsaiSid": "s1", "name": "My Session", "status": "done",
            "specIds": [], "config": {}, "createdAt": "", "updatedAt": "",
        }))
        (sessions_dir / "s1.events.jsonl").write_text('{"e": 1}\n')

        # Attach to two tickets
        t1 = board.create_ticket("Ticket A")
        t2 = board.create_ticket("Ticket B")
        board.attach_session(t1.id, "s1")
        board.attach_session(t2.id, "s1")
        board.update_ticket(t1.id, status="described")
        board.update_ticket(t1.id, status="specified")
        board.set_plan_path(t1.id, "plans/test.md")
        board.set_orchestrator(t1.id, "s1")

        # Detach from all tickets (what AgentService.trash_session does)
        board.detach_session_from_all("s1")

        # Verify refs are cleaned
        t1 = board.get_ticket(t1.id)
        t2 = board.get_ticket(t2.id)
        assert "s1" not in t1.session_ids
        assert t1.orchestrator_session_id is None
        assert "s1" not in t2.session_ids

        # Trash the session
        trash.trash_session("s1")
        assert not (sessions_dir / "s1.json").exists()
        assert not (sessions_dir / "s1.events.jsonl").exists()

        # Verify it's in trash
        items = trash.list_trashed(item_type="sessions")
        assert len(items) == 1
        assert items[0]["id"] == "s1"

        # Restore the session
        trash.restore_session("s1")
        assert (sessions_dir / "s1.json").exists()
        assert (sessions_dir / "s1.events.jsonl").exists()
        restored = json.loads((sessions_dir / "s1.json").read_text())
        assert restored["name"] == "My Session"

        # Trash is empty now
        assert trash.list_trashed() == []

    def test_ticket_trash_and_restore(self, tmp_path: Path) -> None:
        board, trash = _setup(tmp_path)
        t = board.create_ticket("To be trashed")
        tid = t.id

        trash.trash_ticket(tid)
        assert board.list_tickets() == []  # gone from active list

        trash.restore_ticket(tid)
        tickets = board.list_tickets()
        assert len(tickets) == 1
        assert tickets[0].id == tid

    def test_purge_after_trash(self, tmp_path: Path) -> None:
        board, trash = _setup(tmp_path)

        sessions_dir = tmp_path / ".bonsai" / "sessions"
        (sessions_dir / "gone.json").write_text('{"bonsaiSid": "gone"}')

        trash.trash_session("gone")
        trash.purge("sessions", "gone")

        # Cannot restore after purge
        assert trash.list_trashed() == []
        assert not (sessions_dir / "gone.json").exists()

    def test_empty_trash_clears_all(self, tmp_path: Path) -> None:
        board, trash = _setup(tmp_path)

        sessions_dir = tmp_path / ".bonsai" / "sessions"
        for sid in ["x", "y"]:
            (sessions_dir / f"{sid}.json").write_text("{}")

        t = board.create_ticket("Ephemeral")

        trash.trash_session("x")
        trash.trash_session("y")
        trash.trash_ticket(t.id)

        assert len(trash.list_trashed()) == 3
        trash.empty_trash()
        assert trash.list_trashed() == []
