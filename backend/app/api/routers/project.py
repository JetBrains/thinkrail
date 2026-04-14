"""REST endpoints for project management and health check."""

from __future__ import annotations

import json
from pathlib import Path

import pathspec
from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter()

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


def _load_bonsaihide(root: Path) -> pathspec.PathSpec:
    hide_file = root / ".bonsaihide"
    try:
        text = hide_file.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        text = _BONSAIHIDE_DEFAULTS
    return pathspec.PathSpec.from_lines("gitwildmatch", text.splitlines())


class _InitBody(BaseModel):
    path: str


@router.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}


@router.get("/api/project/list")
async def list_projects(base: str = Query(default=""), max_depth: int = Query(default=4)):
    """List directories containing .bonsai/registry.json."""
    root = Path(base).expanduser().resolve() if base else Path.home()
    projects: list[dict] = []

    if not root.is_dir():
        return {"projects": []}

    def _scan(directory: Path, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            children = sorted(directory.iterdir())
        except PermissionError:
            return
        for child in children:
            if not child.is_dir() or child.name.startswith("."):
                continue
            if (child / ".bonsai" / "registry.json").is_file():
                projects.append({"path": str(child), "name": child.name})
            else:
                _scan(child, depth + 1)

    _scan(root, 1)
    return {"projects": projects}


@router.get("/api/project/validate")
async def validate_project(path: str = Query(...)):
    p = Path(path).expanduser().resolve()
    has_specs = (p / ".bonsai" / "registry.json").is_file()
    return {
        "valid": has_specs,
        "path": str(p),
        "name": p.name,
        "exists": p.is_dir(),
    }


@router.post("/api/project/init")
async def init_project(body: _InitBody):
    p = Path(body.path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    bonsai_dir = p / ".bonsai"
    bonsai_dir.mkdir(exist_ok=True)
    registry = bonsai_dir / "registry.json"
    if not registry.exists():
        registry.write_text(
            json.dumps(
                {
                    "version": "2.0",
                    "project": p.name,
                    "specs": [],
                    "links": [],
                },
                indent=2,
            )
        )
    return {"path": str(p), "name": p.name}


@router.get("/api/project/files")
async def list_files(
    path: str = Query(...),
    max_depth: int = Query(10),
    show_hidden: bool = Query(False),
):
    """List project directory tree (files and folders)."""
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        return {"entries": []}

    spec = _load_bonsaihide(root)
    entries: list[dict] = []

    def walk(dir_path: Path, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            children = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            return
        for child in children:
            rel = str(child.relative_to(root))
            is_dir = child.is_dir()
            if not show_hidden and spec.match_file(rel + "/" if is_dir else rel):
                continue
            entries.append({
                "path": rel,
                "name": child.name,
                "isDir": is_dir,
                "depth": depth,
            })
            if is_dir:
                walk(child, depth + 1)

    walk(root, 0)
    return {"entries": entries}
