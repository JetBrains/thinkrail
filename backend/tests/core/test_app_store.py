"""Tests for AppStore (SQLite-backed app-level storage)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import aiosqlite
import pytest

from app.core.app_store import AppStore


@pytest.fixture
async def store(tmp_path: Path):
    s = AppStore(tmp_path)
    await s.open()
    yield s
    await s.close()


# ── Schema (v3) ────────────────────────────────────────────────────────


class TestFreshSchema:
    async def test_fresh_open_creates_v3_schema(self, tmp_path: Path) -> None:
        """Opening a fresh data dir creates the v3 schema and version row."""
        store = AppStore(tmp_path)
        await store.open()
        try:
            db_path = tmp_path / "tr.db"
            assert db_path.is_file()

            # Use a separate sync connection so we don't fight WAL/locks.
            conn = sqlite3.connect(str(db_path))
            try:
                versions = conn.execute(
                    "SELECT version FROM _schema_version"
                ).fetchall()
                assert (3,) in versions

                table_rows = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                tables = {row[0] for row in table_rows}
                assert "_schema_version" in tables
                assert "settings" in tables
                assert "projects" in tables

                # Legacy / dropped tables must not exist
                assert "users" not in tables
                assert "tokens" not in tables
                assert "user_preferences" not in tables
                assert "user_recent_projects" not in tables
                assert "server_config" not in tables

                index_rows = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='index'"
                ).fetchall()
                indexes = {row[0] for row in index_rows}
                assert "idx_projects_last_opened" in indexes
            finally:
                conn.close()
        finally:
            await store.close()


# ── Settings ───────────────────────────────────────────────────────────


class TestSettings:
    async def test_setting_roundtrip(self, store: AppStore) -> None:
        await store.set_setting("foo", {"a": 1, "b": [1, 2, 3]})
        assert await store.get_setting("foo") == {"a": 1, "b": [1, 2, 3]}

    async def test_get_setting_missing_returns_none(self, store: AppStore) -> None:
        assert await store.get_setting("missing") is None

    async def test_set_setting_overwrites(self, store: AppStore) -> None:
        await store.set_setting("k", {"v": 1})
        await store.set_setting("k", {"v": 2})
        assert await store.get_setting("k") == {"v": 2}


# ── Projects ───────────────────────────────────────────────────────────


class TestProjects:
    async def test_register_and_list(self, store: AppStore, tmp_path: Path) -> None:
        proj1 = tmp_path / "proj1"
        proj2 = tmp_path / "proj2"
        proj1.mkdir()
        proj2.mkdir()
        await store.register_project(str(proj1), "proj1")
        await store.register_project(str(proj2), "proj2")
        projects = await store.list_projects()
        assert len(projects) == 2
        # Most recently opened first (proj2 was registered last)
        assert projects[0].name == "proj2"

    async def test_register_project_idempotent(self, store: AppStore, tmp_path: Path) -> None:
        """Calling register_project twice for the same path doesn't error
        and updates the name."""
        proj = tmp_path / "proj"
        proj.mkdir()
        await store.register_project(str(proj), "proj")
        await store.register_project(str(proj), "proj-renamed")  # no error
        projects = await store.list_projects()
        assert len(projects) == 1
        assert projects[0].name == "proj-renamed"

    async def test_register_project_reports_first_insert(
        self, store: AppStore, tmp_path: Path
    ) -> None:
        """The first registration of a path returns True; re-registering False."""
        proj = tmp_path / "proj"
        proj.mkdir()
        assert await store.register_project(str(proj), "proj") is True
        assert await store.register_project(str(proj), "proj") is False

    async def test_update_last_opened(self, store: AppStore, tmp_path: Path) -> None:
        proj = tmp_path / "proj"
        proj.mkdir()
        await store.register_project(str(proj), "proj")
        original = (await store.list_projects())[0].last_opened_at
        await store.update_project_last_opened(str(proj))
        updated = (await store.list_projects())[0].last_opened_at
        assert updated >= original

    async def test_remove_project(self, store: AppStore, tmp_path: Path) -> None:
        proj = tmp_path / "proj"
        proj.mkdir()
        await store.register_project(str(proj), "proj")
        await store.remove_project(str(proj))
        assert await store.list_projects() == []

    async def test_list_projects_filters_nonexistent(self, store: AppStore, tmp_path: Path) -> None:
        """Entries whose directories have been deleted are excluded from the list."""
        proj = tmp_path / "proj"
        proj.mkdir()
        await store.register_project(str(proj), "proj")
        assert len(await store.list_projects()) == 1
        # Simulate directory being deleted (e.g. e2e temp dir cleanup)
        proj.rmdir()
        assert await store.list_projects() == []


# ── Migration v2 → v3 ──────────────────────────────────────────────────


class TestMigration:
    async def test_v2_to_v3_migration(self, tmp_path: Path) -> None:
        """Pre-create a v2 DB by hand, then open via AppStore and verify the
        migration drops legacy tables, renames server_config→settings, and
        leaves projects intact.
        """
        # Create real directories so list_projects doesn't filter them out.
        p1_dir = tmp_path / "p1"
        p2_dir = tmp_path / "p2"
        p1_dir.mkdir()
        p2_dir.mkdir()

        db_path = tmp_path / "tr.db"

        # Build a v2 database using raw aiosqlite (no AppStore involved).
        conn = await aiosqlite.connect(str(db_path))
        try:
            await conn.executescript(
                """
                CREATE TABLE _schema_version (
                    version    INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );

                CREATE TABLE server_config (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                ) WITHOUT ROWID;

                CREATE TABLE users (
                    id           TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    is_admin     INTEGER NOT NULL DEFAULT 0,
                    created_at   TEXT NOT NULL,
                    updated_at   TEXT NOT NULL
                ) WITHOUT ROWID;

                CREATE TABLE tokens (
                    token      TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL REFERENCES users(id),
                    created_at TEXT NOT NULL
                ) WITHOUT ROWID;

                CREATE TABLE projects (
                    path           TEXT PRIMARY KEY,
                    name           TEXT NOT NULL,
                    registered_at  TEXT NOT NULL,
                    last_opened_at TEXT NOT NULL
                ) WITHOUT ROWID;

                CREATE TABLE user_preferences (
                    user_id    TEXT PRIMARY KEY REFERENCES users(id),
                    prefs      TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                ) WITHOUT ROWID;

                CREATE TABLE user_recent_projects (
                    user_id      TEXT NOT NULL REFERENCES users(id),
                    project_path TEXT NOT NULL REFERENCES projects(path),
                    last_opened  TEXT NOT NULL,
                    PRIMARY KEY (user_id, project_path)
                ) WITHOUT ROWID;
                """
            )
            await conn.execute(
                "INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)",
                (2, "2026-01-01T00:00:00+00:00"),
            )
            await conn.execute(
                "INSERT INTO server_config (key, value, updated_at) VALUES (?, ?, ?)",
                ("test_key", '{"x": 1}', "2026-01-01T00:00:00+00:00"),
            )
            await conn.execute(
                """INSERT INTO projects (path, name, registered_at, last_opened_at)
                   VALUES (?, ?, ?, ?)""",
                (str(p1_dir), "p1", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
            )
            await conn.execute(
                """INSERT INTO projects (path, name, registered_at, last_opened_at)
                   VALUES (?, ?, ?, ?)""",
                (str(p2_dir), "p2", "2026-01-02T00:00:00+00:00", "2026-01-02T00:00:00+00:00"),
            )
            await conn.commit()
        finally:
            await conn.close()

        # Now open via AppStore — should migrate cleanly.
        store = AppStore(tmp_path)
        await store.open()
        try:
            # Verify legacy tables are gone (raw sync inspection).
            sync = sqlite3.connect(str(db_path))
            try:
                rows = sync.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
                tables = {row[0] for row in rows}
                assert "users" not in tables
                assert "tokens" not in tables
                assert "user_preferences" not in tables
                assert "user_recent_projects" not in tables
                assert "server_config" not in tables
                assert "settings" in tables
                assert "projects" in tables

                # Schema version bumped to 3.
                versions = sync.execute(
                    "SELECT version FROM _schema_version"
                ).fetchall()
                version_set = {row[0] for row in versions}
                assert max(version_set) == 3
            finally:
                sync.close()

            # Pre-existing setting was preserved across the rename.
            assert await store.get_setting("test_key") == {"x": 1}

            # Both projects are still present.
            projects = await store.list_projects()
            assert len(projects) == 2
            paths = {p.path for p in projects}
            assert paths == {str(p1_dir), str(p2_dir)}
        finally:
            await store.close()
