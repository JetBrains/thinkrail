"""RPC handlers for settings/*, appSettings/*, runtimes/*, and skills/* methods."""

from __future__ import annotations

import logging
from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success
from pydantic import ValidationError

from app import analytics
from app.agent.runtime import (
    RuntimeCapabilities,
    RuntimeIdentity,
    RuntimeRegistry,
    UnknownRuntimeError,
)
from app.analytics import AnalyticsStatus
from app.core.app_store import AppStore
from app.core.config import AppConfig
from app.core.session_defaults import (
    SessionDefaults,
    load_session_defaults,
    save_session_defaults,
)
from app.core.settings import (
    ensure_settings_file,
    load_settings,
    save_settings,
)
from app.rpc.errors import UNKNOWN_RUNTIME, rpc_handler, serialize_result
from app.rpc.schema_export import RuntimesCapabilitiesRequest, RuntimesListResponse

logger = logging.getLogger(__name__)

_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602

# Decorator with the standard ``rpc_handler`` mappings plus the
# ``UnknownRuntimeError → UNKNOWN_RUNTIME (-32031)`` translation needed by
# ``list_runtime_skills``. Kept separate from the module-level
# ``_handle_errors`` so the other handlers in this file retain their
# established ``ValueError → INVALID_PARAMS`` behaviour.
_handle_errors_with_runtime = rpc_handler(
    (UnknownRuntimeError, UNKNOWN_RUNTIME, "Unknown runtime"),
)


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(*args: Any, **params: Any) -> Result:
        try:
            return Success(serialize_result(await func(*args, **params)))
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except JsonRpcError:
            raise
    return wrapper


def _declared_flags(registry: RuntimeRegistry) -> list[Any]:
    """Collect every registered runtime's declared flags.

    Session defaults carry no runtime, so the cold-start record is seeded
    with flags from all runtimes. A runtime whose ``capabilities`` raises is
    skipped rather than failing the whole request.
    """
    flags: list[Any] = []
    for rt in registry.all():
        try:
            flags.extend(rt.capabilities().flags)
        except Exception:
            logger.debug("capabilities() failed for a runtime", exc_info=True)
    return flags


# ── Settings ──────────────────────────────────────────────────────────────


@_handle_errors
async def get_settings(config: AppConfig, **_params: Any) -> dict:
    """Return current project settings."""
    return load_settings(config.project_root).model_dump()


@_handle_errors
async def update_settings(config: AppConfig, **params: Any) -> dict:
    """Validate and write settings, return the saved result."""
    data = params.get("settings")
    if not isinstance(data, dict):
        raise ValueError("settings must be a JSON object")
    saved = save_settings(config.project_root, data)
    return saved.model_dump()


@_handle_errors
async def ensure_settings(config: AppConfig, **_params: Any) -> dict:
    """Create settings file with defaults if missing, return settings."""
    settings = ensure_settings_file(config.project_root)
    return settings.model_dump()


# ── App Settings (user-scope, app-wide) ───────────────────────────────────


@_handle_errors
async def get_session_defaults(
    app_store: AppStore, registry: RuntimeRegistry, **_params: Any,
) -> dict:
    """Return the user's session-creation defaults.

    On cold start the record is seeded once — including each runtime flag
    at its declared default — so the client mirrors a complete record
    without computing defaults itself.
    """
    cfg = await load_session_defaults(app_store, _declared_flags(registry))
    return cfg.model_dump(by_alias=True)


@_handle_errors
async def set_session_defaults(app_store: AppStore, **params: Any) -> dict:
    """Validate and persist the user's session-creation defaults verbatim."""
    cfg = SessionDefaults.model_validate(params)
    saved = await save_session_defaults(app_store, cfg)
    return saved.model_dump(by_alias=True)


@_handle_errors
async def get_analytics_consent(app_store: AppStore, **_params: Any) -> AnalyticsStatus:
    """Return analytics enablement for the Settings toggle (no id on the wire)."""
    consent = await analytics.get_status(app_store)
    return AnalyticsStatus(enabled=consent.enabled)


@_handle_errors
async def set_analytics_consent(app_store: AppStore, **params: Any) -> AnalyticsStatus:
    """Toggle analytics and return the refreshed enablement.

    ``enabled=true`` mints a fresh ``installation_id`` (``opt_in``);
    ``enabled=false`` clears it (``opt_out``). Refreshes the in-process state
    so the running server respects the change immediately. The id stays
    backend-side — only ``enabled`` crosses the wire.
    """
    if bool(params.get("enabled")):
        await analytics.opt_in(app_store)
    else:
        await analytics.opt_out(app_store)
    consent = await analytics.reload_state(app_store)
    return AnalyticsStatus(enabled=consent.enabled)


@_handle_errors
async def track_onboarding_action(app_store: AppStore, **params: Any) -> dict:
    """Record a wizard done-screen decision (the only frontend-originated event).

    The client sends only ``skillId`` + a closed ``action``; the backend maps
    the skill to a step and stamps the ``installation_id``. A non-wizard skill
    is ignored; an out-of-set ``action`` is rejected as INVALID_PARAMS.
    """
    step = analytics.ONBOARDING_STEP_BY_SKILL.get(params.get("skillId") or "")
    if step is not None:
        analytics.track_event(
            analytics.OnboardingOutcomeActionEvent(step=step, action=params.get("action"))
        )
    return {"ok": True}


# ── Runtimes ────────────────────────────────────────────────────────────────


@_handle_errors
async def runtimes_list(registry: RuntimeRegistry, **_params: Any) -> RuntimesListResponse:
    """Return registered runtimes' identities, sorted by ``runtimeType``.

    Lightweight companion to ``runtimes/capabilities``: the frontend uses
    this on boot to know which runtimes exist without paying for each
    runtime's capability payload.
    """
    return RuntimesListResponse(
        runtimes=[
            RuntimeIdentity(runtime_type=rt.runtime_type, display_name=rt.display_name)
            for rt in registry.all()
        ],
    )


@_handle_errors_with_runtime
async def runtimes_capabilities(
    registry: RuntimeRegistry, **params: Any,
) -> RuntimeCapabilities:
    """Return one runtime's full ``RuntimeCapabilities`` payload.

    Each runtime decides internally whether its model list is static,
    cached, or fetched lazily — callers never see those semantics. Order
    is contract: position 0 of each list is the runtime's default.

    Validates the wire payload through ``RuntimesCapabilitiesRequest`` so
    the camelCase ``runtimeType`` alias and the ``RuntimeType`` literal are
    enforced in one place — a value outside the literal is rejected as
    ``VALIDATION_ERROR`` before the lookup. A recognized runtime with no
    registered instance raises ``UnknownRuntimeError`` (mapped to
    ``UNKNOWN_RUNTIME`` -32031).
    """
    req = RuntimesCapabilitiesRequest.model_validate(params)
    return registry.get(req.runtime_type).capabilities()


# ── Skills ───────────────────────────────────────────────────────────────


@_handle_errors
async def list_skills(config: AppConfig, **_params: Any) -> list[dict]:
    """Return available skills by scanning plugin skill frontmatter."""
    from app.agent.context import scan_skill_frontmatter

    return scan_skill_frontmatter(config.plugin_dir)


@_handle_errors_with_runtime
async def list_runtime_skills(
    registry: RuntimeRegistry, runtime: str, **_params: Any,
) -> list[dict]:
    """Return the named runtime's skill list as wire-shape dicts.

    ``UnknownRuntimeError`` from ``registry.get(runtime)`` is translated
    to RPC error code ``UNKNOWN_RUNTIME`` (-32031) by the decorator, so a
    request for a runtime key with no registered instance surfaces as a
    clean domain error rather than an opaque internal error.

    Each entry uses the camelCase keys produced by
    ``RuntimeSkillInfo.model_dump(by_alias=True)`` — ``id``, ``name``,
    ``description``, ``source`` (all single-word so the casing is
    identical to the Python field names).
    """
    rt = registry.get(runtime)  # type: ignore[arg-type]
    return [s.model_dump(by_alias=True) for s in rt.list_skills()]
