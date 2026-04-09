import json
from pathlib import Path

import pytest

from app.trash.storage import move_to_trash, restore_from_trash, list_trashed, purge_trashed


class TestMoveToTrash:
    def test_moves_single_file(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        meta = sessions_dir / "sid-1.json"
        meta.write_text('{"name": "test"}')

        trash_dir = tmp_path / ".bonsai" / "trash"
        move_to_trash(
            trash_dir=trash_dir,
            item_type="sessions",
            item_id="sid-1",
            source_files=[meta],
            original_dir=str(sessions_dir),
        )

        assert not meta.exists()
        trashed = trash_dir / "sessions" / "sid-1" / "sid-1.json"
        assert trashed.exists()
        assert json.loads(trashed.read_text())["name"] == "test"

        sidecar = trash_dir / "sessions" / "sid-1" / "_trash.json"
        assert sidecar.exists()
        info = json.loads(sidecar.read_text())
        assert info["originalDir"] == str(sessions_dir)
        assert "trashedAt" in info

    def test_moves_multiple_files(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        meta = sessions_dir / "sid-2.json"
        events = sessions_dir / "sid-2.events.jsonl"
        meta.write_text('{"name": "test"}')
        events.write_text('{"event": 1}\n')

        trash_dir = tmp_path / ".bonsai" / "trash"
        move_to_trash(
            trash_dir=trash_dir,
            item_type="sessions",
            item_id="sid-2",
            source_files=[meta, events],
            original_dir=str(sessions_dir),
        )

        assert not meta.exists()
        assert not events.exists()
        assert (trash_dir / "sessions" / "sid-2" / "sid-2.json").exists()
        assert (trash_dir / "sessions" / "sid-2" / "sid-2.events.jsonl").exists()

    def test_skips_nonexistent_files(self, tmp_path: Path) -> None:
        trash_dir = tmp_path / ".bonsai" / "trash"
        missing = tmp_path / "ghost.json"
        move_to_trash(trash_dir, "sessions", "ghost", [missing], str(tmp_path))
        # Only sidecar present
        assert (trash_dir / "sessions" / "ghost" / "_trash.json").exists()


class TestRestoreFromTrash:
    def test_restores_files(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        meta = sessions_dir / "sid-3.json"
        meta.write_text('{"name": "restore-me"}')

        trash_dir = tmp_path / ".bonsai" / "trash"
        move_to_trash(trash_dir, "sessions", "sid-3", [meta], str(sessions_dir))
        assert not meta.exists()

        restore_from_trash(trash_dir, "sessions", "sid-3")
        assert meta.exists()
        assert json.loads(meta.read_text())["name"] == "restore-me"
        assert not (trash_dir / "sessions" / "sid-3").exists()

    def test_restore_missing_raises(self, tmp_path: Path) -> None:
        trash_dir = tmp_path / ".bonsai" / "trash"
        with pytest.raises(FileNotFoundError):
            restore_from_trash(trash_dir, "sessions", "nonexistent")


class TestListTrashed:
    def test_empty(self, tmp_path: Path) -> None:
        trash_dir = tmp_path / ".bonsai" / "trash"
        assert list_trashed(trash_dir) == []

    def test_lists_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        trash_dir = tmp_path / ".bonsai" / "trash"
        for sid in ["a", "b"]:
            f = sessions_dir / f"{sid}.json"
            f.write_text(f'{{"name": "{sid}"}}')
            move_to_trash(trash_dir, "sessions", sid, [f], str(sessions_dir))

        items = list_trashed(trash_dir, item_type="sessions")
        assert len(items) == 2
        ids = {i["id"] for i in items}
        assert ids == {"a", "b"}
        assert all("trashedAt" in i for i in items)
        assert all(i["type"] == "sessions" for i in items)


class TestPurgeTrashed:
    def test_purges(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        f = sessions_dir / "del-me.json"
        f.write_text("{}")
        trash_dir = tmp_path / ".bonsai" / "trash"
        move_to_trash(trash_dir, "sessions", "del-me", [f], str(sessions_dir))

        purge_trashed(trash_dir, "sessions", "del-me")
        assert not (trash_dir / "sessions" / "del-me").exists()
        assert not f.exists()

    def test_purge_missing_raises(self, tmp_path: Path) -> None:
        trash_dir = tmp_path / ".bonsai" / "trash"
        with pytest.raises(FileNotFoundError):
            purge_trashed(trash_dir, "sessions", "nope")
