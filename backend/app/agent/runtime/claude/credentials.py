"""Resolve Anthropic API credentials.

The model registry needs an API credential to call the Anthropic Models
endpoint.  Two sources are supported, in order:

1. ``ANTHROPIC_API_KEY`` environment variable.
2. The API key that the bundled ``claude`` CLI stores in the OS credential
   store when the user logs in via ``claude auth login``.  On macOS this is
   Keychain service ``"Claude Code"``.  (The separate ``"Claude Code-credentials"``
   entry is an OAuth session token, not a usable API key.)

Failures are silent — missing tools, timeouts, and malformed data all
return ``None`` so the caller can fall back to cached/fallback model data.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys

logger = logging.getLogger(__name__)

_KEYCHAIN_SERVICE = "Claude Code"
_KEYCHAIN_TIMEOUT_SECONDS = 2.0


def resolve_anthropic_api_key() -> str | None:
    """Return an Anthropic API key from env or the Claude Code credential store, or None."""
    env_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if env_key:
        return env_key

    managed = _read_claude_code_managed_key()
    if managed:
        return managed

    return None


def _read_claude_code_managed_key() -> str | None:
    """Read the API key that Claude Code stores after ``claude auth login``.

    macOS: macOS Keychain, service name "Claude Code". Other platforms are
    not supported yet (claude-agent-sdk does not document a stable location).
    """
    if sys.platform != "darwin":
        return None

    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", _KEYCHAIN_SERVICE, "-w"],
            capture_output=True,
            text=True,
            timeout=_KEYCHAIN_TIMEOUT_SECONDS,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    except Exception:  # noqa: BLE001
        logger.debug("Unexpected error reading keychain", exc_info=True)
        return None

    if result.returncode != 0:
        return None

    value = result.stdout.strip()
    # Only accept values that look like Anthropic API keys. Other entries
    # (e.g. OAuth session tokens stored under different service names) would
    # not authenticate against api.anthropic.com.
    if not value.startswith("sk-ant-"):
        return None

    return value
