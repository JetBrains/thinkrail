"""Self-upgrade by re-running the install script."""
from __future__ import annotations

import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

from app.core.config import CONFIG_DIRNAME, ENV_PREFIX, PRODUCT_NAME
from app.version import CHANNEL, VERSION

INSTALL_SCRIPT_URL = os.environ.get(
    f"{ENV_PREFIX}INSTALL_SCRIPT_URL",
    "https://raw.githubusercontent.com/JetBrains/bonsai/main/install.sh",
)
INSTALL_METADATA_PATH = Path.home() / ".config" / CONFIG_DIRNAME / "install.json"

_VERSION_RE = re.compile(r"^(?:latest|\d+\.\d+\.\d+(?:-nightly\.\d+)?)$")
_PREFIX_FORBIDDEN_CHARS = set(';|&`$<>\n\r"\'\\')


def _load_install_metadata() -> dict[str, object]:
    try:
        with INSTALL_METADATA_PATH.open() as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _validate_prefix(prefix: str) -> bool:
    if not isinstance(prefix, str) or not prefix:
        return False
    if any(c in prefix for c in _PREFIX_FORBIDDEN_CHARS):
        return False
    return Path(prefix).is_absolute()


def _discover_token() -> str | None:
    """Find a GitHub token: env vars first, then `gh auth token` if available."""
    for env_key in ("GH_TOKEN", "GITHUB_TOKEN"):
        token = os.environ.get(env_key)
        if token:
            return token
    try:
        result = subprocess.run(
            ["gh", "auth", "token"], capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return (result.stdout or "").strip() or None
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def run_upgrade(channel: str | None = None, version: str = "latest") -> int:
    if platform.system() == "Windows":
        print(
            "Automatic upgrade on Windows is not yet supported.\n"
            "Download the latest binary from:\n"
            "  https://github.com/JetBrains/bonsai/releases",
            file=sys.stderr,
        )
        return 1

    if not _VERSION_RE.match(version):
        print(f"error: invalid --version: {version!r}", file=sys.stderr)
        return 1

    meta = _load_install_metadata()
    raw_channel = channel or meta.get("channel") or (CHANNEL if CHANNEL != "dev" else "stable")
    if raw_channel not in {"stable", "nightly"}:
        print(f"error: invalid channel from install metadata: {raw_channel!r}", file=sys.stderr)
        return 1
    resolved_channel: str = raw_channel

    raw_prefix = meta.get("prefix") or str(Path.home() / ".local")
    if not _validate_prefix(raw_prefix if isinstance(raw_prefix, str) else ""):
        print(f"error: refusing suspicious prefix from install metadata: {raw_prefix!r}", file=sys.stderr)
        return 1
    prefix: str = raw_prefix  # type: ignore[assignment]

    print(f"Upgrading {PRODUCT_NAME} (current: {VERSION}, channel: {resolved_channel}) ...")

    token = _discover_token()
    curl_cmd = ["curl", "-fsSL"]
    if token:
        curl_cmd += ["-H", f"Authorization: Bearer {token}"]
    curl_cmd.append(INSTALL_SCRIPT_URL)

    try:
        script = subprocess.check_output(curl_cmd, timeout=30)
    except FileNotFoundError:
        print("error: curl not found; cannot fetch installer", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as e:
        print(f"error: failed to fetch installer (exit {e.returncode})", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print("error: timeout fetching installer", file=sys.stderr)
        return 1

    args = ["bash", "-s", "--", "--channel", resolved_channel, "--prefix", prefix]
    if version != "latest":
        args += ["--version", version]

    env = os.environ.copy()
    if token and not env.get("GH_TOKEN") and not env.get("GITHUB_TOKEN"):
        env["GH_TOKEN"] = token

    try:
        return subprocess.run(args, input=script, env=env).returncode
    except FileNotFoundError:
        print("error: bash not found; cannot run installer", file=sys.stderr)
        return 1
