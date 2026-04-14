"""Token-based authentication for multi-client WebSocket connections.

Authentication is two-tier:

1. **Server-wide** — tokens are resolved via the ``ServerStore`` SQLite
   database at ``~/.bonsai/bonsai.db``.
2. **Per-project fallback** — if a token is not found server-wide, the
   legacy ``.bonsai/users.json`` in the project directory is checked.
   A successful fallback hit lazily migrates the token to the server
   store.

Anonymous access is **not** supported — every connection must carry a
valid token.
"""

from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.server_store import ServerStore

logger = logging.getLogger(__name__)

_TOKEN_PREFIX = "bns_"
_TOKEN_BYTES = 16  # 32 hex chars


@dataclass
class UserIdentity:
    """Resolved identity from a token lookup."""

    user_id: str
    display_name: str
    is_admin: bool = False


def generate_token() -> str:
    """Generate a new random token with the ``bns_`` prefix."""
    return _TOKEN_PREFIX + secrets.token_hex(_TOKEN_BYTES)


def _load_project_users(project_root: Path) -> dict[str, UserIdentity]:
    """Load the legacy per-project ``users.json`` token map.

    Returns a mapping of token → ``UserIdentity``.  Used only as a
    fallback during migration from per-project to server-wide auth.
    """
    from app.core.project import ensure_meta_file

    bonsai_dir = project_root / ".bonsai"
    try:
        raw = ensure_meta_file(bonsai_dir, "users.json")
    except (ValueError, OSError) as exc:
        logger.warning("Failed to ensure users.json: %s", exc)
        return {}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse users.json: %s", exc)
        return {}

    token_map: dict[str, UserIdentity] = {}
    for entry in data.get("users", []):
        token = entry.get("token", "")
        user_id = entry.get("id", "")
        name = entry.get("name", user_id)
        if token and user_id:
            token_map[token] = UserIdentity(user_id=user_id, display_name=name)

    return token_map


async def authenticate(
    server_store: ServerStore,
    project_root: Path,
    token: str | None,
) -> UserIdentity | None:
    """Validate a token against the server-wide store (with per-project fallback).

    Returns a ``UserIdentity`` on success, or ``None`` if authentication
    fails.  No anonymous access — a missing or invalid token always
    returns ``None``.
    """
    if not token:
        return None

    # 1. Server-wide lookup (SQLite)
    user_id = await server_store.resolve_token(token)
    if user_id is not None:
        user = await server_store.get_user(user_id)
        if user:
            return UserIdentity(user_id=user.id, display_name=user.display_name, is_admin=user.is_admin)

    # 2. Per-project fallback (legacy users.json)
    project_map = _load_project_users(project_root)
    identity = project_map.get(token)
    if identity is not None:
        # Lazy-migrate to server-wide store
        try:
            await server_store.ensure_user(identity.user_id, identity.display_name)
            await server_store.register_token(token, identity.user_id)
            logger.info(
                "Migrated token for user %r from project users.json to server store",
                identity.user_id,
            )
        except Exception:
            logger.warning("Failed to migrate token for %r", identity.user_id, exc_info=True)
        return identity

    # Invalid token
    return None


async def authenticate_rest(
    server_store: ServerStore,
    token: str | None,
) -> UserIdentity | None:
    """Validate a token for REST endpoints (no per-project fallback).

    Used by pre-WebSocket REST endpoints where no project context is
    available (e.g. ``/api/user/profile``).
    """
    if not token:
        return None

    user_id = await server_store.resolve_token(token)
    if user_id is None:
        return None

    user = await server_store.get_user(user_id)
    if not user:
        return None

    return UserIdentity(user_id=user.id, display_name=user.display_name, is_admin=user.is_admin)
