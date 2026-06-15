"""User-scoped session-creation defaults.

A single record holding the user's preferred model / permission-mode /
effort for new sessions. Pre-fills every new-session entry point so the
UI never reverts to a hardcoded baseline.

Stored as a JSON value in :class:`AppStore` under the
:data:`SESSION_DEFAULTS_KEY` setting. Because ThinkRail is single-user and
localhost-only, the AppStore is effectively the user scope — these
preferences live in ``~/.tr/tr.db`` and travel with the user
across projects, not with any one project tree.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.agent.models import to_camel
from app.core.app_store import AppStore

if TYPE_CHECKING:
    from app.agent.runtime import RuntimeFlag

logger = logging.getLogger(__name__)


# ── Cold-start defaults ────────────────────────────────────────────────
#
# Used only when the AppStore key is absent (fresh install or wiped
# ``~/.tr/tr.db``). Module-level so tests and callers can
# reference them without instantiating the model.

COLD_START_MODEL = "claude-opus-4-8"
COLD_START_PERMISSION_MODE = "default"
COLD_START_EFFORT = "auto"


# ── AppStore key ───────────────────────────────────────────────────────

SESSION_DEFAULTS_KEY = "session_defaults"


# ── Model ──────────────────────────────────────────────────────────────


class SessionDefaults(BaseModel):
    """User preferences applied to every new-session draft.

    Field names use snake_case internally and serialize to camelCase on
    the wire via the shared :func:`to_camel` alias generator (same
    pattern as ``SessionConfig``). ``populate_by_name=True`` so both wire
    (``permissionMode``) and Python (``permission_mode``) keys are
    accepted as input — required because we round-trip the dict through
    SQLite which stores whichever key style the writer used.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    model: str = COLD_START_MODEL
    permission_mode: str = COLD_START_PERMISSION_MODE
    effort: str = COLD_START_EFFORT
    # Runtime-declared option toggles (keyed by RuntimeFlag.key); empty means
    # every flag uses its runtime default.
    flags: dict[str, bool] = Field(default_factory=dict)

    @field_validator("effort", mode="before")
    @classmethod
    def _coerce_legacy_null_effort(cls, v: Any) -> Any:
        """Map legacy persisted ``effort: null`` to the neutral ``"auto"``."""
        return "auto" if v is None else v


# ── Persistence helpers ────────────────────────────────────────────────


def _cold_start_defaults(declared_flags: Sequence[RuntimeFlag]) -> SessionDefaults:
    """The record written on first access: field defaults, plus each
    runtime-declared flag at its declared default."""
    return SessionDefaults(flags={f.key: f.default for f in declared_flags})


async def save_session_defaults(
    app_store: AppStore, cfg: SessionDefaults
) -> SessionDefaults:
    """Persist *cfg* verbatim and return it (for echo to the caller)."""
    await app_store.set_setting(SESSION_DEFAULTS_KEY, cfg.model_dump())
    return cfg


async def load_session_defaults(
    app_store: AppStore, declared_flags: Sequence[RuntimeFlag] = ()
) -> SessionDefaults:
    """Return the stored record, seeding it once on cold start.

    When no valid record exists, the cold-start defaults — including each
    runtime flag at its declared default — are written once and returned.
    Every later read returns the stored record verbatim. A corrupt payload
    is logged and reseeded.
    """
    raw = await app_store.get_setting(SESSION_DEFAULTS_KEY)
    if raw:
        try:
            return SessionDefaults.model_validate(raw)
        except Exception:
            logger.debug(
                "Failed to validate stored %s; reseeding cold-start defaults",
                SESSION_DEFAULTS_KEY,
                exc_info=True,
            )
    return await save_session_defaults(app_store, _cold_start_defaults(declared_flags))
