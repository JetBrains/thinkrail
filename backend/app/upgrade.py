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
    "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
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


def run_upgrade(channel: str | None = None, version: str = "latest") -> int:
    if platform.system() == "Windows":
        print(
            "Automatic upgrade on Windows is not yet supported.\n"
            "Download the latest binary from:\n"
            "https://github.com/JetBrains/thinkrail/releases",
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

    try:
        script = subprocess.check_output(["curl", "-fsSL", INSTALL_SCRIPT_URL], timeout=30)
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

    try:
        return subprocess.run(args, input=script).returncode
    except FileNotFoundError:
        print("error: bash not found; cannot run installer", file=sys.stderr)
        return 1
