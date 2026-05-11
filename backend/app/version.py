"""Version info, startup banner, and background update check."""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import threading
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from app._version import __channel__ as CHANNEL
    from app._version import __commit__ as COMMIT
    from app._version import __version__ as VERSION
except ImportError:
    VERSION = "0.0.0-dev"
    CHANNEL = "dev"
    COMMIT = ""

GITHUB_REPO = os.environ.get("BONSAI_GITHUB_REPO", "JetBrains/bonsai")
GITHUB_API = f"https://api.github.com/repos/{GITHUB_REPO}"

CACHE_PATH = Path.home() / ".config" / "bonsai" / "update-check.json"
CACHE_TTL = timedelta(hours=6)
HTTP_TIMEOUT = 5.0

logger = logging.getLogger(__name__)

_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-nightly\.(\d+))?$")


def _normalize(v: str) -> str | None:
    m = _VERSION_RE.match(v)
    if not m:
        return None
    major, minor, patch, n = m.groups()
    is_release = "1" if n is None else "0"
    n_val = 0 if n is None else int(n)
    return f"{int(major):010d}.{int(minor):010d}.{int(patch):010d}.{is_release}.{n_val:010d}"


def is_newer(latest: str, current: str) -> bool:
    a, b = _normalize(latest), _normalize(current)
    return bool(a) and bool(b) and a > b


def print_banner() -> None:
    suffix = f" · {COMMIT}" if COMMIT else ""
    print(f"Bonsai {VERSION} ({CHANNEL}){suffix}", flush=True)


def _read_cache() -> tuple[str, str] | None:
    try:
        with CACHE_PATH.open() as f:
            data = json.load(f)
        if data.get("channel") != CHANNEL:
            return None
        checked = datetime.fromisoformat(data["checked_at"])
        if datetime.now(tz=timezone.utc) - checked < CACHE_TTL:
            return data["latest"], data["url"]
    except Exception:
        return None
    return None


def _write_cache(latest: str, url: str) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CACHE_PATH.open("w") as f:
            json.dump(
                {
                    "channel": CHANNEL,
                    "latest": latest,
                    "url": url,
                    "checked_at": datetime.now(tz=timezone.utc).isoformat(),
                },
                f,
            )
    except Exception:
        logger.debug("update check: failed to write cache", exc_info=True)


def _fetch_latest() -> tuple[str, str] | None:
    """Return (version_without_v, release_url) for the latest release on the current channel."""
    if CHANNEL == "stable":
        url = f"{GITHUB_API}/releases/latest"
        try:
            with urllib.request.urlopen(
                urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"}),
                timeout=HTTP_TIMEOUT,
            ) as r:
                data = json.load(r)
        except Exception:
            return None
        tag = data.get("tag_name", "")
        if not tag:
            return None
        return tag.lstrip("v"), data.get("html_url", "")

    url = f"{GITHUB_API}/releases?per_page=20"
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"}),
            timeout=HTTP_TIMEOUT,
        ) as r:
            releases = json.load(r)
    except Exception:
        return None

    for rel in releases:
        if not rel.get("prerelease"):
            continue
        tag = rel.get("tag_name", "")
        if "-nightly." not in tag:
            continue
        return tag.lstrip("v"), rel.get("html_url", "")
    return None


def _check_and_announce() -> None:
    cached = _read_cache()
    if cached:
        latest, url = cached
    else:
        fetched = _fetch_latest()
        if fetched is None:
            return
        latest, url = fetched
        _write_cache(latest, url)

    if is_newer(latest, VERSION):
        print(
            f"[update] Bonsai {latest} is available (current: {VERSION}). Run: bonsai upgrade",
            file=sys.stdout,
            flush=True,
        )
        if url:
            print(f"[update] {url}", file=sys.stdout, flush=True)


def check_in_background() -> None:
    if CHANNEL == "dev":
        return
    threading.Thread(
        target=_check_and_announce,
        name="bonsai-update-check",
        daemon=True,
    ).start()
