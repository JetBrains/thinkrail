"""Consent record persistence in :class:`AppStore`.

The ``AnalyticsConsent`` record (``installation_id`` + ``enabled``) is stored
as a JSON value under :data:`ANALYTICS_KEY` and is the single runtime source of
truth for analytics. Mirrors the persistence pattern of
``core/session_defaults.py``. Because ThinkRail is single-user and
localhost-only, the AppStore is the user scope — this record lives in
``~/.tr/tr.db`` and travels with the user across projects.
"""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from app.analytics.models import AnalyticsConsent
from app.core.app_store import AppStore
from app.core.config import get_data_dir

logger = logging.getLogger(__name__)


# ── AppStore key ───────────────────────────────────────────────────────

ANALYTICS_KEY = "analytics"


# ── Persistence helpers ────────────────────────────────────────────────


async def load_consent(app_store: AppStore) -> AnalyticsConsent | None:
    """Return the stored consent record, or ``None`` when none exists.

    Unlike ``session_defaults`` this does **not** seed on a miss: seeding is
    ``service.initialize``'s job, because it must consult the install default
    and emit ``app_installed``. A corrupt payload is logged and treated as a
    miss.
    """
    raw = await app_store.get_setting(ANALYTICS_KEY)
    if raw is None:
        return None
    try:
        return AnalyticsConsent.model_validate(raw)
    except Exception:
        logger.debug("Failed to validate stored %s", ANALYTICS_KEY, exc_info=True)
        return None


async def save_consent(app_store: AppStore, consent: AnalyticsConsent) -> AnalyticsConsent:
    """Persist *consent* verbatim and return it."""
    await app_store.set_setting(ANALYTICS_KEY, consent.model_dump())
    return consent


# ── Consent mutations (single source of truth) ─────────────────────────


async def opt_in(app_store: AppStore) -> str:
    """Mint a fresh ``installation_id``, enable analytics, return the id.

    A fresh ``uuid4`` every time means re-enabling after an opt-out starts a
    new cohort with no continuity — an opted-out user is not re-identified.
    """
    installation_id = str(uuid4())
    await save_consent(
        app_store, AnalyticsConsent(enabled=True, installation_id=installation_id)
    )
    return installation_id


async def opt_out(app_store: AppStore) -> None:
    """Delete the ``installation_id`` and disable analytics."""
    await save_consent(app_store, AnalyticsConsent(enabled=False, installation_id=None))


async def get_status(app_store: AppStore) -> AnalyticsConsent:
    """Return the stored consent, or the default posture when none exists.

    The default posture (``enabled=True``, no id) reflects what
    ``initialize`` would seed on the next startup of a fresh install.
    """
    return await load_consent(app_store) or AnalyticsConsent()


# ── Packaged-CLI entry ─────────────────────────────────────────────────


def run_cli(action: str) -> int:
    """Apply ``enable`` / ``disable`` / ``status`` against the AppStore record.

    Synchronous entry for the packaged binary's ``thinkrail analytics``
    command (see ``packaging/entry.py``). Opens its own AppStore — there is no
    running server. Returns a process exit code.
    """
    try:
        return asyncio.run(_run_cli(action))
    except Exception as exc:  # never surface a traceback to the CLI user
        print(f"error: analytics {action} failed: {exc}")
        return 1


async def _run_cli(action: str) -> int:
    store = AppStore(get_data_dir())
    await store.open()
    try:
        if action == "enable":
            installation_id = await opt_in(store)
            print(f"Anonymous usage analytics enabled (installation {installation_id}).")
        elif action == "disable":
            await opt_out(store)
            print("Anonymous usage analytics disabled.")
        elif action == "status":
            consent = await get_status(store)
            if not consent.enabled:
                print("Anonymous usage analytics: disabled.")
            elif consent.installation_id:
                print(
                    f"Anonymous usage analytics: enabled (installation {consent.installation_id})."
                )
            else:
                print("Anonymous usage analytics: enabled (not yet initialized).")
        else:
            print(f"error: unknown analytics action: {action!r}")
            return 1
        return 0
    finally:
        await store.close()
