"""Analytics facade: singleton state, event stamping, transport sink.

``initialize`` seeds consent and emits lifecycle events at startup;
``track_event`` is a fire-and-forget emitter that stamps the in-memory
``_state`` and hands the payload to ``_send``. Both are wrapped so they can
never block or crash their callers. The delivery backend is hidden behind the
private ``_send`` sink (currently no-op / log-only).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
from dataclasses import dataclass

from app.analytics.consent import (
    get_status,
    load_consent,
    opt_in,
    save_consent,
)
from app.analytics.models import (
    AnalyticsConsent,
    AnalyticsEvent,
    AppInstalledEvent,
    AppStartedEvent,
)
from app.core.app_store import AppStore
from app.core.config import (
    ENV_PREFIX,
    INSTALL_METADATA_PATH,
    PRODUCT_NAME,
    get_data_dir,
)
from app.version import CHANNEL, VERSION

logger = logging.getLogger(__name__)


# ── Environment metadata (low-cardinality, non-personal) ───────────────


def _detect_os() -> str:
    """Map ``platform.system()`` to the install.sh OS vocabulary."""
    return {"Darwin": "macos", "Linux": "linux", "Windows": "windows"}.get(
        platform.system(), platform.system().lower()
    )


def _detect_arch() -> str:
    """Map ``platform.machine()`` to the install.sh arch vocabulary."""
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "x64"
    if machine in ("arm64", "aarch64"):
        return "arm64"
    return machine


_ENV: dict[str, str] = {
    "channel": CHANNEL,
    "version": VERSION,
    "os": _detect_os(),
    "arch": _detect_arch(),
}


# ── Transport sink (delivery backend deferred) ─────────────────────────

# Reserved for the real transport; endpoint/key follow the ``THINKRAIL_``-
# prefixed env-override convention (as ``upgrade.py`` does for the installer).
_ENDPOINT = os.environ.get(f"{ENV_PREFIX}ANALYTICS_ENDPOINT", "")
_API_KEY = os.environ.get(f"{ENV_PREFIX}ANALYTICS_API_KEY", "")


def _send(payload: dict) -> None:
    """Hand a stamped, serialized event to the delivery backend.

    No transport backend is wired yet: events are logged at debug and
    dropped. ``_ENDPOINT`` / ``_API_KEY`` are reserved for the eventual
    fire-and-forget ``httpx`` send.
    """
    logger.debug("analytics event (sink=noop): %s", payload)


# ── Install default ────────────────────────────────────────────────────


def _install_default_enabled() -> bool:
    """Whether a fresh install seeds analytics enabled.

    Enabled unless the installer recorded an explicit opt-out
    (``--no-analytics`` → ``"analytics": false`` in ``install.json``).
    """
    try:
        with INSTALL_METADATA_PATH.open() as f:
            meta = json.load(f)
    except (OSError, json.JSONDecodeError):
        return True
    return meta.get("analytics") is not False


# ── Singleton state ────────────────────────────────────────────────────


@dataclass
class _State:
    enabled: bool
    installation_id: str | None


_state: _State | None = None


def _stamp(event: AnalyticsEvent, installation_id: str) -> AnalyticsEvent:
    """Return a copy of *event* with the identifier and environment filled in."""
    updates: dict[str, object] = {"installation_id": installation_id}
    fields = type(event).model_fields
    for key in ("channel", "version", "os", "arch"):
        if key in fields:
            updates[key] = _ENV[key]
    return event.model_copy(update=updates)


# ── Public facade ──────────────────────────────────────────────────────


def track_event(event: AnalyticsEvent) -> None:
    """Fire-and-forget emit. No-ops when disabled/uninitialized; never raises."""
    state = _state
    if state is None or not state.enabled or not state.installation_id:
        return
    try:
        _send(_stamp(event, state.installation_id).model_dump(by_alias=True))
    except Exception:
        logger.debug("analytics track_event failed", exc_info=True)


async def initialize(app_store: AppStore) -> None:
    """Load consent, seed on a fresh install, and emit lifecycle events.

    Wrapped so a failure can never block or crash startup.
    """
    try:
        await _initialize(app_store)
    except Exception:
        logger.debug("analytics initialize failed", exc_info=True)


async def _initialize(app_store: AppStore) -> None:
    global _state
    consent = await load_consent(app_store)
    first_run = consent is None
    if consent is None:
        if _install_default_enabled():
            installation_id = await opt_in(app_store)
            consent = AnalyticsConsent(enabled=True, installation_id=installation_id)
        else:
            consent = AnalyticsConsent(enabled=False, installation_id=None)
            await save_consent(app_store, consent)

    _state = _State(enabled=consent.enabled, installation_id=consent.installation_id)
    if not (_state.enabled and _state.installation_id):
        return  # disabled — never touches the network

    if first_run:
        print(
            f"{PRODUCT_NAME}: anonymous usage analytics enabled — "
            "disable with `thinkrail analytics --disable`",
            flush=True,
        )
        track_event(AppInstalledEvent())
    track_event(AppStartedEvent())


async def reload_state(app_store: AppStore) -> AnalyticsConsent:
    """Refresh ``_state`` from the persisted record after a toggle."""
    global _state
    consent = await get_status(app_store)
    _state = _State(enabled=consent.enabled, installation_id=consent.installation_id)
    return consent


def emit_oneshot(event: AnalyticsEvent) -> None:
    """Best-effort emit from a short-lived process with no running server.

    Used by the ``upgrade`` CLI: opens its own AppStore, respects consent,
    then sends. Wrapped so it never affects its caller.
    """
    try:
        asyncio.run(_emit_oneshot(event))
    except Exception:
        logger.debug("analytics emit_oneshot failed", exc_info=True)


async def _emit_oneshot(event: AnalyticsEvent) -> None:
    store = AppStore(get_data_dir())
    await store.open()
    try:
        consent = await load_consent(store)
        if not consent or not consent.enabled or not consent.installation_id:
            return
        _send(_stamp(event, consent.installation_id).model_dump(by_alias=True))
    finally:
        await store.close()
