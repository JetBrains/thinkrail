import json
from pathlib import Path

import pytest

from app.trash.service import TrashService


def _make_trash_service(tmp_path: Path) -> TrashService:
    return TrashService(project_root=tmp_path)


class TestTrashSession:
    def test_moves_session_files(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".specs" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "s1.json").write_text('{"bonsaiSid": "s1", "name": "test"}')
        (sessions_dir / "s1.events.jsonl").write_text('{"e": 1}\n')

        svc = _make_trash_service(tmp_path)
        svc.trash_session("s1")

        assert not (sessions_dir / "s1.json").exists()
        assert not (sessions_dir / "s1.events.jsonl").exists()
        assert (tmp_path / ".bonsai" / "trash" / "sessions" / "s1" / "s1.json").exists()

    def test_trash_missing_session_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        svc.trash_session("nonexistent")


class TestTrashTicket:
    def test_moves_ticket_file(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t1.json").write_text('{"id": "t1", "title": "bug"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t1")

        assert not (tickets_dir / "t1.json").exists()
        assert (tmp_path / ".bonsai" / "trash" / "tickets" / "t1" / "t1.json").exists()


class TestRestoreSession:
    def test_restores_session(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".specs" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "s2.json").write_text('{"name": "hi"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_session("s2")
        svc.restore_session("s2")

        assert (sessions_dir / "s2.json").exists()

    def test_restore_missing_raises(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        with pytest.raises(FileNotFoundError):
            svc.restore_session("nope")


class TestRestoreTicket:
    def test_restores_ticket(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "t2.json").write_text('{"id": "t2"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t2")
        svc.restore_ticket("t2")

        assert (tickets_dir / "t2.json").exists()


class TestListAndPurge:
    def test_list_all(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".specs" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "x.json").write_text("{}")
        tickets_dir = tmp_path / ".bonsai" / "meta-tickets"
        tickets_dir.mkdir(parents=True)
        (tickets_dir / "y.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("x")
        svc.trash_ticket("y")

        items = svc.list_trashed()
        assert len(items) == 2
        types = {i["type"] for i in items}
        assert types == {"sessions", "tickets"}

    def test_purge(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".specs" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "p.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("p")
        svc.purge("sessions", "p")

        assert svc.list_trashed() == []

    def test_empty_trash(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".specs" / "sessions"
        sessions_dir.mkdir(parents=True)
        for sid in ["a", "b"]:
            (sessions_dir / f"{sid}.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("a")
        svc.trash_session("b")
        svc.empty_trash()
        assert svc.list_trashed() == []
