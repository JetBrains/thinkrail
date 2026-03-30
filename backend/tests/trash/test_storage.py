from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.trash.storage import (
    list_trashed,
    move_to_trash,
    purge_trashed,
    restore_from_trash,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_session_files(base: Path, sid: str, *, extra: bool = False) -> tuple[Path, list[Path]]:
    """Create fake session files (.json + .events.jsonl) in *base*/<sid> dir."""
    session_dir = base / sid
    session_dir.mkdir(parents=True, exist_ok=True)
    meta = session_dir / f"{sid}.json"
    events = session_dir / f"{sid}.events.jsonl"
    meta.write_text('{"bonsaiSid": "' + sid + '"}', encoding="utf-8")
    events.write_text('{"eventType":"start"}\n', encoding="utf-8")
    files = [meta, events]
    if extra:
        extra_file = session_dir / "extra.txt"
        extra_file.write_text("extra", encoding="utf-8")
        files.append(extra_file)
    return session_dir, files


# ---------------------------------------------------------------------------
# TestMoveToTrash
# ---------------------------------------------------------------------------


class TestMoveToTrash:
    def test_moves_files_and_writes_meta(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        trash_dir = tmp_path / "trash"
        session_dir, files = _make_session_files(sessions_dir, "abc123")

        bucket = move_to_trash(trash_dir, "sessions", "abc123", files, sessions_dir)

        # Files exist in trash
        assert (bucket / "abc123.json").is_file()
        assert (bucket / "abc123.events.jsonl").is_file()
        # Originals removed
        assert not (sessions_dir / "abc123.json").exists()
        assert not (sessions_dir / "abc123.events.jsonl").exists()
        # Metadata written
        meta_path = bucket / "_trash_meta.json"
        assert meta_path.is_file()
        meta = json.loads(meta_path.read_text())
        assert meta["item_type"] == "sessions"
        assert meta["item_id"] == "abc123"
        assert "trashed_at" in meta
        assert meta["original_dir"] == str(sessions_dir)

    def test_raises_if_already_trashed(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        trash_dir = tmp_path / "trash"
        session_dir, files = _make_session_files(sessions_dir, "dup123")

        move_to_trash(trash_dir, "sessions", "dup123", files, sessions_dir)

        # Second call with same id should raise
        with pytest.raises(FileExistsError, match="already in trash"):
            move_to_trash(trash_dir, "sessions", "dup123", [], sessions_dir)

    def test_skips_nonexistent_source_files(self, tmp_path: Path) -> None:
        trash_dir = tmp_path / "trash"
        missing = tmp_path / "ghost.json"

        # Should not raise even though the file doesn't exist
        bucket = move_to_trash(trash_dir, "sessions", "ghost", [missing], tmp_path)
        assert bucket.is_dir()
        # Only meta file present
        assert list(bucket.iterdir()) == [bucket / "_trash_meta.json"]


# ---------------------------------------------------------------------------
# TestRestoreFromTrash
# ---------------------------------------------------------------------------


class TestRestoreFromTrash:
    def test_restores_files_to_original_dir(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        trash_dir = tmp_path / "trash"
        _session_dir, files = _make_session_files(sessions_dir, "res123")

        move_to_trash(trash_dir, "sessions", "res123", files, sessions_dir)
        # Originals gone
        assert not (sessions_dir / "res123.json").exists()

        restored_dir = restore_from_trash(trash_dir, "sessions", "res123")

        assert restored_dir == sessions_dir
        assert (sessions_dir / "res123.json").is_file()
        assert (sessions_dir / "res123.events.jsonl").is_file()
        # Trash bucket removed
        assert not (trash_dir / "sessions" / "res123").exists()

    def test_raises_if_not_in_trash(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="not found"):
            restore_from_trash(tmp_path / "trash", "sessions", "nope")


# ---------------------------------------------------------------------------
# TestListTrashed
# ---------------------------------------------------------------------------


class TestListTrashed:
    def test_empty_when_no_trash_dir(self, tmp_path: Path) -> None:
        result = list_trashed(tmp_path / "trash")
        assert result == []

    def test_lists_all_items(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        trash_dir = tmp_path / "trash"

        for sid in ("s1", "s2"):
            _, files = _make_session_files(sessions_dir, sid)
            move_to_trash(trash_dir, "sessions", sid, files, sessions_dir)

        items = list_trashed(trash_dir)
        assert len(items) == 2
        ids = {i["item_id"] for i in items}
        assert ids == {"s1", "s2"}

    def test_filters_by_type(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        tickets_dir = tmp_path / "tickets"
        trash_dir = tmp_path / "trash"

        # Create one session and one ticket
        _, s_files = _make_session_files(sessions_dir, "sess1")
        move_to_trash(trash_dir, "sessions", "sess1", s_files, sessions_dir)

        t_file = tickets_dir / "tick1.json"
        tickets_dir.mkdir(parents=True, exist_ok=True)
        t_file.write_text('{"id":"tick1"}', encoding="utf-8")
        move_to_trash(trash_dir, "tickets", "tick1", [t_file], tickets_dir)

        sessions_only = list_trashed(trash_dir, item_type="sessions")
        assert len(sessions_only) == 1
        assert sessions_only[0]["item_type"] == "sessions"

        tickets_only = list_trashed(trash_dir, item_type="tickets")
        assert len(tickets_only) == 1
        assert tickets_only[0]["item_type"] == "tickets"


# ---------------------------------------------------------------------------
# TestPurgeTrashed
# ---------------------------------------------------------------------------


class TestPurgeTrashed:
    def test_purge_removes_bucket(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / "sessions"
        trash_dir = tmp_path / "trash"
        _, files = _make_session_files(sessions_dir, "del123")

        move_to_trash(trash_dir, "sessions", "del123", files, sessions_dir)
        bucket = trash_dir / "sessions" / "del123"
        assert bucket.is_dir()

        purge_trashed(trash_dir, "sessions", "del123")
        assert not bucket.exists()

    def test_purge_raises_if_not_in_trash(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError, match="not found"):
            purge_trashed(tmp_path / "trash", "sessions", "nope")
