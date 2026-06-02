import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.trash.service import TrashService


def _make_trash_service(tmp_path: Path) -> TrashService:
    return TrashService(project_root=tmp_path)


class TestTrashSession:
    def test_moves_session_files(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
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
    def test_moves_ticket_files(self, tmp_path: Path) -> None:
        ticket_folder = tmp_path / ".bonsai" / "tickets" / "t1"
        ticket_folder.mkdir(parents=True)
        (ticket_folder / "ticket.json").write_text('{"id": "t1", "title": "bug"}')
        (ticket_folder / "product-design.md").write_text("# pd")

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t1")

        # Source files moved out of the folder
        assert not (ticket_folder / "ticket.json").exists()
        assert not (ticket_folder / "product-design.md").exists()
        # Trash item contains both files
        trash_root = tmp_path / ".bonsai" / "trash" / "tickets" / "t1"
        assert (trash_root / "ticket.json").exists()
        assert (trash_root / "product-design.md").exists()


class TestRestoreSession:
    def test_restores_session(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
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
        ticket_folder = tmp_path / ".bonsai" / "tickets" / "t2"
        ticket_folder.mkdir(parents=True)
        (ticket_folder / "ticket.json").write_text('{"id": "t2", "title": "x"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t2")
        svc.restore_ticket("t2")

        assert (ticket_folder / "ticket.json").is_file()


class TestListAndPurge:
    def test_list_all(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "x.json").write_text("{}")
        ticket_folder = tmp_path / ".bonsai" / "tickets" / "y"
        ticket_folder.mkdir(parents=True)
        (ticket_folder / "ticket.json").write_text('{"id": "y"}')

        svc = _make_trash_service(tmp_path)
        svc.trash_session("x")
        svc.trash_ticket("y")

        items = svc.list_trashed()
        assert len(items) == 2
        types = {i["type"] for i in items}
        assert types == {"sessions", "tickets"}

    def test_purge(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "p.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("p")
        svc.purge("sessions", "p")

        assert svc.list_trashed() == []

    def test_empty_trash(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        for sid in ["a", "b"]:
            (sessions_dir / f"{sid}.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("a")
        svc.trash_session("b")
        svc.empty_trash()
        assert svc.list_trashed() == []


class TestTrashSpec:
    def test_moves_spec_file_with_context(self, tmp_path: Path) -> None:
        spec_dir = tmp_path / "mod_a"
        spec_dir.mkdir(parents=True)
        spec_file = spec_dir / "README.md"
        spec_file.write_text("# Module A\n\nContent.")

        registry_entry = {"id": "mod-a", "type": "module-design", "path": "mod_a/README.md"}
        links = [{"from": "mod-a", "to": "design-doc", "type": "parent"}]

        svc = _make_trash_service(tmp_path)
        svc.trash_spec("mod-a", spec_file, registry_entry, links)

        assert not spec_file.exists()
        trash_item = tmp_path / ".bonsai" / "trash" / "specs" / "mod-a"
        assert (trash_item / "README.md").exists()

        sidecar = trash_item / "_trash.json"
        info = json.loads(sidecar.read_text())
        assert info["context"]["registryEntry"] == registry_entry
        assert info["context"]["links"] == links

    def test_restore_returns_context(self, tmp_path: Path) -> None:
        spec_dir = tmp_path / "mod_b"
        spec_dir.mkdir(parents=True)
        spec_file = spec_dir / "README.md"
        spec_file.write_text("# Module B")

        registry_entry = {"id": "mod-b", "type": "module-design"}
        links = [{"from": "mod-b", "to": "x", "type": "child"}]

        svc = _make_trash_service(tmp_path)
        svc.trash_spec("mod-b", spec_file, registry_entry, links)
        entry, restored_links = svc.restore_spec("mod-b")

        assert spec_file.exists()
        assert entry == registry_entry
        assert restored_links == links

    def test_trash_missing_spec_is_noop(self, tmp_path: Path) -> None:
        svc = _make_trash_service(tmp_path)
        missing = tmp_path / "nonexistent" / "README.md"
        svc.trash_spec("ghost", missing, {}, [])
        # No crash, no trashed items
        assert svc.list_trashed(item_type="specs") == []


class TestCascadeTicket:
    def test_trashes_entire_folder(self, tmp_path: Path) -> None:
        # Unified layout: ticket.json + four artifacts in one folder
        ticket_folder = tmp_path / ".bonsai" / "tickets" / "t1"
        ticket_folder.mkdir(parents=True)
        (ticket_folder / "ticket.json").write_text('{"id": "t1", "title": "bug"}')
        (ticket_folder / "product-design.md").write_text("# pd")
        (ticket_folder / "technical-design.md").write_text("# td")
        (ticket_folder / "history.patch").write_text("diff")
        (ticket_folder / "implementation-plan.md").write_text("# plan")

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t1", cascade=True)

        # Every file moved out
        for fn in ("ticket.json", "product-design.md", "technical-design.md",
                   "history.patch", "implementation-plan.md"):
            assert not (ticket_folder / fn).exists()

        # Trash context references the ticket folder
        trash_marker = tmp_path / ".bonsai" / "trash" / "tickets" / "t1" / "_trash.json"
        info = json.loads(trash_marker.read_text())
        assert info["context"]["artifactDir"].endswith(".bonsai/tickets/t1")

    def test_cascade_flag_is_noop(self, tmp_path: Path) -> None:
        """With unified layout, cascade=False still trashes the whole folder."""
        ticket_folder = tmp_path / ".bonsai" / "tickets" / "t2"
        ticket_folder.mkdir(parents=True)
        (ticket_folder / "ticket.json").write_text('{"id": "t2"}')
        (ticket_folder / "implementation-plan.md").write_text("# Plan")

        svc = _make_trash_service(tmp_path)
        svc.trash_ticket("t2", cascade=False)

        # Both still trashed despite cascade=False
        assert not (ticket_folder / "ticket.json").exists()
        assert not (ticket_folder / "implementation-plan.md").exists()


class TestAutoPurge:
    def _set_trashed_at(self, trash_dir: Path, item_type: str, item_id: str, dt: datetime) -> None:
        """Overwrite the trashedAt timestamp in _trash.json."""
        sidecar = trash_dir / item_type / item_id / "_trash.json"
        info = json.loads(sidecar.read_text())
        info["trashedAt"] = dt.isoformat()
        sidecar.write_text(json.dumps(info))

    def test_purges_old_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "old.json").write_text("{}")
        (sessions_dir / "new.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("old")
        svc.trash_session("new")

        trash_dir = tmp_path / ".bonsai" / "trash"
        old_date = datetime.now(UTC) - timedelta(days=31)
        self._set_trashed_at(trash_dir, "sessions", "old", old_date)

        purged = svc.auto_purge(30)

        assert purged == 1
        # Old item is gone
        assert not (trash_dir / "sessions" / "old").exists()
        # New item retained
        assert (trash_dir / "sessions" / "new").exists()

    def test_retains_recent_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "recent.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("recent")

        purged = svc.auto_purge(30)
        assert purged == 0
        assert (tmp_path / ".bonsai" / "trash" / "sessions" / "recent").exists()

    def test_zero_retention_skips(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "x.json").write_text("{}")

        svc = _make_trash_service(tmp_path)
        svc.trash_session("x")

        trash_dir = tmp_path / ".bonsai" / "trash"
        old_date = datetime.now(UTC) - timedelta(days=999)
        self._set_trashed_at(trash_dir, "sessions", "x", old_date)

        purged = svc.auto_purge(0)
        assert purged == 0
        # Item still there despite being very old
        assert (trash_dir / "sessions" / "x").exists()
