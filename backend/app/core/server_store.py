"""Server-level persistent storage backed by SQLite.

Manages users, auth tokens, known projects, user preferences,
and recent-project tracking.  All data lives in a single SQLite
database at ``~/.bonsai/bonsai.db`` (or ``$BONSAI_DATA_DIR/bonsai.db``).
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

@dataclass
class User:
    id: str
    display_name: str
    created_at: str
    updated_at: str
    is_admin: bool = False


@dataclass
class Token:
    token: str
    user_id: str
    created_at: str


@dataclass
class KnownProject:
    path: str
    name: str
    registered_at: str
    last_opened_at: str


@dataclass
class RecentProject:
    project_path: str
    name: str
    last_opened: str


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA_VERSION = 2

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

CREATE TABLE IF NOT EXISTS server_config (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    is_admin     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS projects (
    path           TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    registered_at  TEXT NOT NULL,
    last_opened_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id    TEXT PRIMARY KEY REFERENCES users(id),
    prefs      TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_recent_projects (
    user_id      TEXT NOT NULL REFERENCES users(id),
    project_path TEXT NOT NULL REFERENCES projects(path),
    last_opened  TEXT NOT NULL,
    PRIMARY KEY (user_id, project_path)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_tokens_user_id
    ON tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_recent_projects_user_time
    ON user_recent_projects(user_id, last_opened DESC);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# ServerStore
# ---------------------------------------------------------------------------

class ServerStore:
    """Async facade over a server-level SQLite database."""

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._db_path = data_dir / "bonsai.db"
        self._conn: aiosqlite.Connection | None = None

    # -- lifecycle ----------------------------------------------------------

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

        # Schema
        await self._conn.executescript(_SCHEMA)

        # Version tracking
        async with self._conn.execute(
            "SELECT MAX(version) FROM _schema_version"
        ) as cur:
            row = await cur.fetchone()
            current = row[0] if row and row[0] else 0

        # Run migrations
        if current < 2:
            await self._migrate_v1_to_v2()

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
        assert self._conn is not None, "ServerStore not opened"
        return self._conn

    # -- migrations ---------------------------------------------------------

    async def _migrate_v1_to_v2(self) -> None:
        """Add is_admin column to users table (idempotent).

        Auto-promotes the first user (by creation time) to admin so that
        pre-admin installations have at least one admin after migration.
        """
        async with self._db.execute("PRAGMA table_info(users)") as cur:
            columns = {row[1] async for row in cur}
        if "is_admin" not in columns:
            await self._db.execute(
                "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0"
            )
            # Auto-promote the earliest user to admin
            await self._db.execute(
                """UPDATE users SET is_admin = 1
                   WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)"""
            )

    # -- users --------------------------------------------------------------

    async def get_user(self, user_id: str) -> User | None:
        async with self._db.execute(
            "SELECT id, display_name, is_admin, created_at, updated_at FROM users WHERE id = ?",
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            return User(
                id=row["id"],
                display_name=row["display_name"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                is_admin=bool(row["is_admin"]),
            )

    async def create_user(self, user_id: str, display_name: str, *, is_admin: bool = False) -> User:
        now = _now()
        await self._db.execute(
            "INSERT INTO users (id, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, display_name, int(is_admin), now, now),
        )
        await self._db.commit()
        return User(id=user_id, display_name=display_name, created_at=now, updated_at=now, is_admin=is_admin)

    async def ensure_user(self, user_id: str, display_name: str) -> User:
        """Return existing user or create a new one."""
        user = await self.get_user(user_id)
        if user:
            return user
        return await self.create_user(user_id, display_name)

    async def list_users(self) -> list[User]:
        async with self._db.execute(
            "SELECT id, display_name, is_admin, created_at, updated_at FROM users ORDER BY id"
        ) as cur:
            return [
                User(
                    id=row["id"],
                    display_name=row["display_name"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                    is_admin=bool(row["is_admin"]),
                )
                async for row in cur
            ]

    async def user_count(self) -> int:
        """Return the total number of users."""
        async with self._db.execute("SELECT COUNT(*) FROM users") as cur:
            row = await cur.fetchone()
            return row[0]

    async def admin_count(self) -> int:
        """Return the number of admin users."""
        async with self._db.execute(
            "SELECT COUNT(*) FROM users WHERE is_admin = 1"
        ) as cur:
            row = await cur.fetchone()
            return row[0]

    async def set_admin(self, user_id: str, is_admin: bool) -> None:
        """Set or unset admin status for a user."""
        await self._db.execute(
            "UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?",
            (int(is_admin), _now(), user_id),
        )
        await self._db.commit()

    async def delete_user(self, user_id: str) -> None:
        """Delete a user and all their tokens, preferences, and recent projects."""
        await self._db.execute(
            "DELETE FROM user_recent_projects WHERE user_id = ?", (user_id,)
        )
        await self._db.execute(
            "DELETE FROM user_preferences WHERE user_id = ?", (user_id,)
        )
        await self._db.execute("DELETE FROM tokens WHERE user_id = ?", (user_id,))
        await self._db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await self._db.commit()

    # -- tokens -------------------------------------------------------------

    async def resolve_token(self, token: str) -> str | None:
        """Return the user_id for a token, or None if invalid."""
        async with self._db.execute(
            "SELECT user_id FROM tokens WHERE token = ?", (token,)
        ) as cur:
            row = await cur.fetchone()
            return row["user_id"] if row else None

    async def create_token(self, user_id: str) -> str:
        """Generate a new ``bns_`` token for the given user."""
        token = f"bns_{secrets.token_hex(16)}"
        await self._db.execute(
            "INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, _now()),
        )
        await self._db.commit()
        return token

    async def revoke_token(self, token: str) -> None:
        await self._db.execute("DELETE FROM tokens WHERE token = ?", (token,))
        await self._db.commit()

    async def list_tokens(self, user_id: str) -> list[Token]:
        async with self._db.execute(
            "SELECT token, user_id, created_at FROM tokens WHERE user_id = ? ORDER BY created_at",
            (user_id,),
        ) as cur:
            return [
                Token(token=row["token"], user_id=row["user_id"], created_at=row["created_at"])
                async for row in cur
            ]

    async def register_token(self, token: str, user_id: str) -> None:
        """Register an existing token (used during migration from per-project users.json)."""
        await self._db.execute(
            "INSERT OR IGNORE INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, _now()),
        )
        await self._db.commit()

    # -- projects -----------------------------------------------------------

    async def list_projects(self) -> list[KnownProject]:
        async with self._db.execute(
            "SELECT path, name, registered_at, last_opened_at FROM projects ORDER BY last_opened_at DESC"
        ) as cur:
            return [
                KnownProject(
                    path=row["path"],
                    name=row["name"],
                    registered_at=row["registered_at"],
                    last_opened_at=row["last_opened_at"],
                )
                async for row in cur
            ]

    async def register_project(self, path: str, name: str) -> None:
        """Register a project (idempotent — updates name if already known)."""
        now = _now()
        await self._db.execute(
            """INSERT INTO projects (path, name, registered_at, last_opened_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET name = excluded.name""",
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
        # Remove user_recent_projects references first (FK constraint)
        await self._db.execute(
            "DELETE FROM user_recent_projects WHERE project_path = ?", (path,)
        )
        await self._db.execute("DELETE FROM projects WHERE path = ?", (path,))
        await self._db.commit()

    # -- user preferences ---------------------------------------------------

    async def get_preferences(self, user_id: str) -> dict:
        async with self._db.execute(
            "SELECT prefs FROM user_preferences WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return {}
            return json.loads(row["prefs"])

    async def update_preferences(self, user_id: str, patch: dict) -> dict:
        """Merge *patch* into existing preferences and return the result."""
        current = await self.get_preferences(user_id)
        current.update(patch)
        now = _now()
        await self._db.execute(
            """INSERT INTO user_preferences (user_id, prefs, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at""",
            (user_id, json.dumps(current), now),
        )
        await self._db.commit()
        return current

    # -- user recent projects -----------------------------------------------

    async def get_recent_projects(self, user_id: str, limit: int = 10) -> list[RecentProject]:
        async with self._db.execute(
            """SELECT urp.project_path, p.name, urp.last_opened
               FROM user_recent_projects urp
               JOIN projects p ON p.path = urp.project_path
               WHERE urp.user_id = ?
               ORDER BY urp.last_opened DESC
               LIMIT ?""",
            (user_id, limit),
        ) as cur:
            return [
                RecentProject(
                    project_path=row["project_path"],
                    name=row["name"],
                    last_opened=row["last_opened"],
                )
                async for row in cur
            ]

    async def add_recent_project(self, user_id: str, project_path: str) -> None:
        """Record that a user opened a project (upsert)."""
        now = _now()
        await self._db.execute(
            """INSERT INTO user_recent_projects (user_id, project_path, last_opened)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id, project_path) DO UPDATE SET last_opened = excluded.last_opened""",
            (user_id, project_path, now),
        )
        await self._db.commit()
