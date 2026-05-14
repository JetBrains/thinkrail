"""User-scoped session-creation defaults.

A single record holding the user's preferred model / permission-mode /
effort / max-turns for new sessions. Pre-fills every new-session entry
point so the UI never reverts to a hardcoded baseline.

Stored as a JSON value in :class:`AppStore` under the
:data:`SESSION_DEFAULTS_KEY` setting. Because Bonsai is single-user and
localhost-only, the AppStore is effectively the user scope — these
preferences live in ``~/.bonsai/bonsai.db`` and travel with the user
across projects, not with any one project tree.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, ConfigDict

from app.agent.models import to_camel
from app.core.app_store import AppStore

logger = logging.getLogger(__name__)


# ── Cold-start defaults ────────────────────────────────────────────────
#
# Used only when the AppStore key is absent (fresh install or wiped
# ``~/.bonsai/bonsai.db``). Module-level so tests and callers can
# reference them without instantiating the model.

COLD_START_MODEL = "claude-opus-4-7"
COLD_START_PERMISSION_MODE = "default"
COLD_START_EFFORT: str | None = None  # ``None`` renders as "auto" in the UI.
COLD_START_MAX_TURNS = 50


# ── AppStore key ───────────────────────────────────────────────────────

SESSION_DEFAULTS_KEY = "session_defaults"


# ── Model ──────────────────────────────────────────────────────────────


class SessionDefaults(BaseModel):
    """User preferences applied to every new-session draft.

    Field names use snake_case internally and serialize to camelCase on
    the wire via the shared :func:`to_camel` alias generator (same
    pattern as ``AgentConfig``). ``populate_by_name=True`` so both wire
    (``permissionMode``) and Python (``permission_mode``) keys are
    accepted as input — required because we round-trip the dict through
    SQLite which stores whichever key style the writer used.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    model: str = COLD_START_MODEL
    permission_mode: str = COLD_START_PERMISSION_MODE
    effort: str | None = COLD_START_EFFORT
    max_turns: int = COLD_START_MAX_TURNS


# ── Persistence helpers ────────────────────────────────────────────────


async def load_session_defaults(app_store: AppStore) -> SessionDefaults:
    """Return the persisted record, or cold-start defaults on miss.

    Always returns a fully-populated model — callers never need to
    handle the absent case themselves. A corrupt/invalid stored payload
    is logged and treated as absent (degrades to cold-start).
    """
    raw = await app_store.get_setting(SESSION_DEFAULTS_KEY)
    if not raw:
        return SessionDefaults()
    try:
        return SessionDefaults.model_validate(raw)
    except Exception:
        logger.debug(
            "Failed to validate stored %s; falling back to cold-start",
            SESSION_DEFAULTS_KEY,
            exc_info=True,
        )
        return SessionDefaults()


async def save_session_defaults(
    app_store: AppStore, cfg: SessionDefaults
) -> SessionDefaults:
    """Persist *cfg* and return it (for echo to the caller)."""
    await app_store.set_setting(SESSION_DEFAULTS_KEY, cfg.model_dump())
    return cfg
