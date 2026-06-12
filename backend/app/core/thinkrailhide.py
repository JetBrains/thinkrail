"""Shared .thinkrailhide pattern loading.

Provides ``load_thinkrailhide()`` — used by both the file tree REST API and
the spec index to apply consistent gitignore-style filtering.
"""

from __future__ import annotations

from pathlib import Path

import pathspec

from app.core.config import HIDE_FILE

_THINKRAILHIDE_DEFAULTS = """\
# Build artifacts & dependencies
node_modules/
dist/
build/
target/
.next/
.nuxt/
.vite/

# Caches
__pycache__/
.mypy_cache/
.pytest_cache/
.ruff_cache/

# Version control & tools
.git/
.claude/
.venv/
"""


def load_thinkrailhide(project_root: Path) -> pathspec.PathSpec:
    """Load ``.thinkrailhide`` patterns from *project_root*, falling back to defaults."""
    hide_file = project_root / HIDE_FILE
    try:
        text = hide_file.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        text = _THINKRAILHIDE_DEFAULTS
    return pathspec.PathSpec.from_lines("gitignore", text.splitlines())
