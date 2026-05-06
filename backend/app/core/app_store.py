"""App-level persistent storage backed by SQLite.

Manages the known-projects registry and app-wide key/value settings.
Bonsai is single-user and localhost-only, so there are no users,
tokens, or per-user preferences here. All data lives in a single
SQLite database at ``~/.bonsai/bonsai.db`` (or
``$BONSAI_DATA_DIR/bonsai.db``).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

# ── Models ─────────────────────────────────────────────────────────────

@dataclass
class KnownProject:
    path: str
    name: str
    registered_at: str
    last_opened_at: str


# ── Schema (v3) ────────────────────────────────────────────────────────

_SCHEMA_VERSION = 3

_PRAGMAS = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = FULL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
"""

_SCHEMA = """
CREATE TABLE IF NOT EXISTS _schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS projects (
    path           TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    registered_at  TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_projects_last_opened
    ON projects(last_opened_at DESC);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── AppStore ───────────────────────────────────────────────────────────

class AppStore:
    """Async facade over the app-level SQLite database."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._db_path = data_dir / "bonsai.db"
        self._conn: aiosqlite.Connection | None = None

    # ── lifecycle ──────────────────────────────────────────────────────

    async def open(self) -> None:
        """Open the database, set PRAGMAs, and run migrations."""
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        self._conn.row_factory = aiosqlite.Row

        # PRAGMAs (must be executed individually)
        for line in _PRAGMAS.strip().splitlines():
            line = line.strip()
            if line:
                await self._conn.execute(line)

        # Schema — `CREATE TABLE IF NOT EXISTS` is safe whether this is a
        # fresh install (creates v3 tables) or a v2 install pending
        # migration (existing legacy tables stay until migration drops them).
        await self._conn.executescript(_SCHEMA)

        # Version tracking
        async with self._conn.execute(
            "SELECT MAX(version) FROM _schema_version"
        ) as cur:
            row = await cur.fetchone()
            current = row[0] if row and row[0] else 0

        # Run migrations
        if current < 3:
            await self._migrate_v2_to_v3()

        if current < _SCHEMA_VERSION:
            await self._conn.execute(
                "INSERT OR REPLACE INTO _schema_version (version, applied_at) VALUES (?, ?)",
                (_SCHEMA_VERSION, _now()),
            )
            await self._conn.commit()

    async def close(self) -> None:
        """Close the database connection."""
        if self._conn:
            await self._conn.close()
            self._conn = None

    @property
    def is_open(self) -> bool:
        """Whether the database connection is open."""
        return self._conn is not None

    @property
    def _db(self) -> aiosqlite.Connection:
        assert self._conn is not None, "AppStore not opened"
        return self._conn

    # ── migrations ─────────────────────────────────────────────────────

    async def _migrate_v2_to_v3(self) -> None:
        """Drop legacy auth tables and rename ``server_config`` → ``settings``.

        Drop order matters because of FK constraints:
        - ``user_recent_projects`` is a child table (FK → users, projects),
          so it must be dropped before ``users`` and ``projects``.
        - ``user_preferences`` references ``users``, so drop before ``users``.
        - ``tokens`` references ``users``, so drop before ``users``.
        - ``users`` and ``server_config`` are independent.

        Rename strategy:
        - The schema bootstrap above this call always runs
          ``CREATE TABLE IF NOT EXISTS settings``, so on a v2 DB both
          ``server_config`` (with data) and ``settings`` (freshly
          created, empty) exist when we get here.
        - When that's the case, drop the empty ``settings`` and rename
          ``server_config`` over it so any preserved key/value rows
          survive the upgrade.
        - If ``server_config`` doesn't exist (fresh install), nothing to
          rename — bootstrap already produced the ``settings`` table.
        - If ``server_config`` exists alongside a non-empty ``settings``
          (extremely unlikely — implies a partial earlier migration),
          keep ``settings`` and drop ``server_config`` to avoid losing
          newer data.
        """
        await self._db.execute("DROP TABLE IF EXISTS user_recent_projects")
        await self._db.execute("DROP TABLE IF EXISTS user_preferences")
        await self._db.execute("DROP TABLE IF EXISTS tokens")
        await self._db.execute("DROP TABLE IF EXISTS users")

        async with self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            ("server_config",),
        ) as cur:
            has_legacy = await cur.fetchone() is not None
        async with self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            ("settings",),
        ) as cur:
            has_settings = await cur.fetchone() is not None

        if has_legacy and has_settings:
            # Determine if `settings` is empty (typical case after
            # schema bootstrap on a v2 DB).
            async with self._db.execute(
                "SELECT COUNT(*) FROM settings"
            ) as cur:
                row = await cur.fetchone()
                settings_rows = row[0] if row else 0

            if settings_rows == 0:
                await self._db.execute("DROP TABLE settings")
                await self._db.execute("ALTER TABLE server_config RENAME TO settings")
            else:
                logger.debug(
                    "Both server_config and settings exist with data; "
                    "dropping server_config and keeping settings"
                )
                await self._db.execute("DROP TABLE server_config")
        elif has_legacy and not has_settings:
            await self._db.execute("ALTER TABLE server_config RENAME TO settings")
        # else: no server_config at all — fresh install, settings already
        # created by schema bootstrap. Nothing to do.

        await self._db.commit()

    # ── projects ───────────────────────────────────────────────────────

    async def list_projects(self) -> list[KnownProject]:
        """Return known projects ordered by most-recently-opened.

        Entries whose directories no longer exist are purged from the
        database automatically (self-healing recents list, consistent
        with IDE behaviour).
        """
        async with self._db.execute(
            "SELECT path, name, registered_at, last_opened_at FROM projects "
            "ORDER BY last_opened_at DESC LIMIT 100"
        ) as cur:
            rows = [dict(row) async for row in cur]

        valid: list[KnownProject] = []
        stale: list[str] = []
        for row in rows:
            if Path(row["path"]).is_dir():
                valid.append(KnownProject(
                    path=row["path"],
                    name=row["name"],
                    registered_at=row["registered_at"],
                    last_opened_at=row["last_opened_at"],
                ))
            else:
                stale.append(row["path"])

        if stale:
            await self._db.executemany(
                "DELETE FROM projects WHERE path = ?", [(p,) for p in stale]
            )
            await self._db.commit()
            logger.debug("Purged %d stale project entries", len(stale))

        return valid

    async def register_project(self, path: str, name: str) -> None:
        """Register a project (idempotent — updates name and last_opened_at if already known)."""
        now = _now()
        await self._db.execute(
            """INSERT INTO projects (path, name, registered_at, last_opened_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET
                   name = excluded.name,
                   last_opened_at = excluded.last_opened_at""",
            (path, name, now, now),
        )
        await self._db.commit()

    async def update_project_last_opened(self, path: str) -> None:
        await self._db.execute(
            "UPDATE projects SET last_opened_at = ? WHERE path = ?",
            (_now(), path),
        )
        await self._db.commit()

    async def remove_project(self, path: str) -> None:
        await self._db.execute("DELETE FROM projects WHERE path = ?", (path,))
        await self._db.commit()

    # ── settings ───────────────────────────────────────────────────────

    async def get_setting(self, key: str) -> dict | None:
        """Return the JSON-decoded value for *key*, or ``None`` on miss."""
        async with self._db.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            try:
                return json.loads(row["value"])
            except json.JSONDecodeError:
                logger.debug("Failed to decode setting %r", key, exc_info=True)
                return None

    async def set_setting(self, key: str, value: dict) -> None:
        """Upsert a JSON-encoded value for *key*."""
        await self._db.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, json.dumps(value), _now()),
        )
        await self._db.commit()
