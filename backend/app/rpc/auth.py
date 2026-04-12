"""Token-based authentication for multi-client WebSocket connections.

Users are defined in ``.bonsai/users.json`` within each project directory.
Tokens are simple shared secrets (``bns_`` prefix + random hex).

Schema::

    {
      "users": [
        { "id": "danya", "name": "Danya", "token": "bns_a8f3k2m9..." }
      ],
      "allowAnonymous": true
    }
"""

from __future__ import annotations

import json
import logging
import secrets
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

_TOKEN_PREFIX = "bns_"
_TOKEN_BYTES = 16  # 32 hex chars


@dataclass
class UserIdentity:
    """Resolved identity from a token lookup."""

    user_id: str
    display_name: str


# Sentinel for anonymous users.
ANONYMOUS = UserIdentity(user_id="anonymous", display_name="Anonymous")


def generate_token() -> str:
    """Generate a new random token with the ``bns_`` prefix."""
    return _TOKEN_PREFIX + secrets.token_hex(_TOKEN_BYTES)


def load_users(project_root: Path) -> tuple[dict[str, UserIdentity], bool]:
    """Load users from ``.bonsai/users.json``.

    Returns ``(token_map, allow_anonymous)`` where *token_map* maps
    token strings to ``UserIdentity`` objects.

    If the file doesn't exist, returns an empty map with
    ``allow_anonymous=True`` (backward-compatible default).
    """
    users_path = project_root / ".bonsai" / "users.json"
    if not users_path.is_file():
        return {}, True

    try:
        data = json.loads(users_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load %s: %s", users_path, exc)
        return {}, True

    allow_anonymous = data.get("allowAnonymous", True)
    token_map: dict[str, UserIdentity] = {}
    for entry in data.get("users", []):
        token = entry.get("token", "")
        user_id = entry.get("id", "")
        name = entry.get("name", user_id)
        if token and user_id:
            token_map[token] = UserIdentity(user_id=user_id, display_name=name)

    return token_map, allow_anonymous


def authenticate(
    project_root: Path, token: str | None
) -> UserIdentity | None:
    """Validate a token against the project's user list.

    Returns a ``UserIdentity`` on success, ``ANONYMOUS`` if no token
    and anonymous access is allowed, or ``None`` if authentication fails
    (invalid token, or no token and anonymous is disabled).
    """
    token_map, allow_anonymous = load_users(project_root)

    if token:
        identity = token_map.get(token)
        if identity is not None:
            return identity
        # Token provided but invalid
        return None

    # No token provided
    if allow_anonymous:
        return ANONYMOUS

    # No token and anonymous not allowed
    return None


def save_user(project_root: Path, user_id: str, name: str, token: str | None = None) -> str:
    """Add or update a user in ``.bonsai/users.json``. Returns the token.

    If *token* is ``None``, a new one is generated. If a user with the
    same *user_id* already exists, their name and token are updated.
    """
    if token is None:
        token = generate_token()

    users_path = project_root / ".bonsai" / "users.json"
    if users_path.is_file():
        try:
            data = json.loads(users_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {"users": [], "allowAnonymous": True}
    else:
        data = {"users": [], "allowAnonymous": True}

    # Update existing or add new
    users = data.get("users", [])
    found = False
    for entry in users:
        if entry.get("id") == user_id:
            entry["name"] = name
            entry["token"] = token
            found = True
            break
    if not found:
        users.append({"id": user_id, "name": name, "token": token})

    data["users"] = users
    users_path.parent.mkdir(parents=True, exist_ok=True)
    users_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return token
