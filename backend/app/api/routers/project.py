"""REST endpoints for project management and health check."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query

from app.api.schemas import (
    FileEntry,
    HealthResponse,
    ProjectFilesResponse,
    ProjectInfo,
    ProjectListResponse,
    ProjectState,
    ProjectValidateResponse,
)
from app.core.bonsaihide import load_bonsaihide
from app.version import VERSION
from app.core.config import BONSAI_DIRNAME
from app.spec.service import SPEC_FILENAME_MAP

router = APIRouter(tags=["project"])


# Deliverables of the spec-driven flows.  Reuses SPEC_FILENAME_MAP to
# stay in sync with what the agent's spec_save tool actually writes.
_SPEC_MARKERS: frozenset[str] = frozenset(SPEC_FILENAME_MAP)


def _has_spec_deliverable(non_dot_children: list[Path]) -> bool:
    """True if any spec marker exists at project root with non-empty content."""
    for child in non_dot_children:
        if child.name not in _SPEC_MARKERS or not child.is_file():
            continue
        try:
            if child.stat().st_size > 0:
                return True
        except OSError:
            continue
    return False


def _detect_project_state(p: Path) -> ProjectState:
    """Classify a directory:
      - ``initialized``: a spec deliverable exists — restore session
      - ``new``: empty workspace — show welcome
      - ``existing``: has user files but no spec — normal workspace

    Falls back to ``existing`` on permission errors — safer than pushing
    the user into the new-project flow on an unreadable directory.
    """
    try:
        non_dot = [c for c in p.iterdir() if not c.name.startswith(".")]
    except OSError:
        return "existing"
    if not non_dot:
        return "new"
    return "initialized" if _has_spec_deliverable(non_dot) else "existing"


@router.get("/api/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version=VERSION)


@router.get("/api/project/list", response_model=ProjectListResponse)
async def list_projects(base: str = Query(default=""), max_depth: int = Query(default=4)) -> ProjectListResponse:
    """List directories containing a .bonsai/ directory."""
    root = Path(base).expanduser().resolve() if base else Path.home()
    projects: list[ProjectInfo] = []

    if not root.is_dir():
        return ProjectListResponse(projects=[])

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
            if (child / BONSAI_DIRNAME).is_dir():
                projects.append(ProjectInfo(path=str(child), name=child.name))
            else:
                _scan(child, depth + 1)

    _scan(root, 1)
    return ProjectListResponse(projects=projects)


@router.get("/api/project/validate", response_model=ProjectValidateResponse)
async def validate_project(path: str = Query(...)) -> ProjectValidateResponse:
    p = Path(path).expanduser().resolve()
    exists = p.is_dir()
    state = _detect_project_state(p) if exists else "new"
    return ProjectValidateResponse(state=state, path=str(p), name=p.name, exists=exists)


@router.get("/api/project/files", response_model=ProjectFilesResponse)
async def list_files(
    path: str = Query(...),
    max_depth: int = Query(10),
    show_hidden: bool = Query(False),
) -> ProjectFilesResponse:
    """List project directory tree (files and folders)."""
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        return ProjectFilesResponse(entries=[])

    spec = load_bonsaihide(root)
    entries: list[FileEntry] = []

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
            entries.append(FileEntry(path=rel, name=child.name, isDir=is_dir, depth=depth))
            if is_dir:
                walk(child, depth + 1)

    walk(root, 0)
    return ProjectFilesResponse(entries=entries)
