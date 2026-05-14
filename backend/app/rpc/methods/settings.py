"""RPC handlers for settings/*, appSettings/*, and models/* methods."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success
from pydantic import ValidationError

from app.agent.runtime import ModelInfo, RuntimeRegistry
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

_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(first_arg: Any, **params: Any) -> Result:
        try:
            return Success(await func(first_arg, **params))
        except (KeyError, TypeError, ValueError, ValidationError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except JsonRpcError:
            raise
    return wrapper


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
async def get_session_defaults(app_store: AppStore, **_params: Any) -> dict:
    """Return the user's session-creation defaults.

    Falls back to cold-start defaults when the AppStore key is absent.
    """
    cfg = await load_session_defaults(app_store)
    return cfg.model_dump(by_alias=True)


@_handle_errors
async def set_session_defaults(app_store: AppStore, **params: Any) -> dict:
    """Validate and persist the user's session-creation defaults."""
    cfg = SessionDefaults.model_validate(params)
    await save_session_defaults(app_store, cfg)
    return cfg.model_dump(by_alias=True)


# ── Models ────────────────────────────────────────────────────────────────


def _model_to_dict(model: ModelInfo) -> dict:
    """Project a neutral ``ModelInfo`` into the wire shape.

    No per-model ``runtime`` field — the runtime is carried by the
    enclosing group, not duplicated on every entry.
    """
    return model.model_dump(by_alias=True)


@_handle_errors
async def list_models(registry: RuntimeRegistry, **_params: Any) -> dict:
    """Return the current model list grouped by runtime.

    Each runtime decides internally whether to refresh on first call,
    serve from cache, or use a static list — callers never see those
    semantics.

    Shape::

        {
          "runtimes": [
            {
              "runtimeType": "claude",
              "displayName": "Claude Code",
              "models": [ { id, label, group, contextWindow, ... }, ... ]
            },
            ...
          ]
        }
    """
    return {
        "runtimes": [
            {
                "runtimeType": runtime.runtime_type,
                "displayName": runtime.display_name,
                "models": [_model_to_dict(m) for m in runtime.list_models()],
            }
            for runtime in registry.all()
        ],
    }


# ── Skills ───────────────────────────────────────────────────────────────


@_handle_errors
async def list_skills(config: AppConfig, **_params: Any) -> list[dict]:
    """Return available skills by scanning plugin skill frontmatter."""
    from app.agent.context import scan_skill_frontmatter

    return scan_skill_frontmatter(config.plugin_dir)
