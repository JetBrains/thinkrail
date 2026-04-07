"""RPC handlers for settings/* and models/* methods."""

from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.core.config import AppConfig
from app.core.settings import (
    ensure_settings_file,
    load_settings,
    save_settings,
)
from app.agent.model_registry import ModelRegistry

_INTERNAL_ERROR = -32603
_INVALID_PARAMS = -32602


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(first_arg: Any, **params: Any) -> Result:
        try:
            return Success(await func(first_arg, **params))
        except (KeyError, TypeError, ValueError) as exc:
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


# ── Models ────────────────────────────────────────────────────────────────


@_handle_errors
async def list_models(registry: ModelRegistry, **_params: Any) -> list[dict]:
    """Return the current model list."""
    return registry.get_models()


@_handle_errors
async def refresh_models(registry: ModelRegistry, **_params: Any) -> list[dict]:
    """Trigger a model refresh and return updated list."""
    return await registry.refresh()
