"""Shared .bonsaihide pattern loading.

Provides ``load_bonsaihide()`` — used by both the file tree REST API and
the spec index to apply consistent gitignore-style filtering.
"""

from __future__ import annotations

from pathlib import Path

import pathspec

_BONSAIHIDE_DEFAULTS = """\
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

# All dotfiles hidden by default
.*

# Exceptions — show these
!.bonsai/
!.bonsaihide
"""


def load_bonsaihide(project_root: Path) -> pathspec.PathSpec:
    """Load ``.bonsaihide`` patterns from *project_root*, falling back to defaults."""
    hide_file = project_root / ".bonsaihide"
    try:
        text = hide_file.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        text = _BONSAIHIDE_DEFAULTS
    return pathspec.PathSpec.from_lines("gitignore", text.splitlines())
