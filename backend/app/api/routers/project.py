"""REST endpoints for project management and health check."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.schemas import (
    FileEntry,
    HealthResponse,
    ProjectFilesResponse,
    ProjectInfo,
    ProjectListResponse,
    ProjectValidateResponse,
)
from app.core.bonsaihide import load_bonsaihide

router = APIRouter(tags=["project"])


class _InitBody(BaseModel):
    path: str


@router.get("/api/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version="1.0.0")


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
            if (child / ".bonsai").is_dir():
                projects.append(ProjectInfo(path=str(child), name=child.name))
            else:
                _scan(child, depth + 1)

    _scan(root, 1)
    return ProjectListResponse(projects=projects)


@router.get("/api/project/validate", response_model=ProjectValidateResponse)
async def validate_project(path: str = Query(...)) -> ProjectValidateResponse:
    p = Path(path).expanduser().resolve()
    has_specs = (p / ".bonsai").is_dir()
    return ProjectValidateResponse(valid=has_specs, path=str(p), name=p.name, exists=p.is_dir())


@router.post("/api/project/init", response_model=ProjectInfo)
async def init_project(body: _InitBody) -> ProjectInfo:
    p = Path(body.path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    bonsai_dir = p / ".bonsai"
    bonsai_dir.mkdir(exist_ok=True)
    return ProjectInfo(path=str(p), name=p.name)


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
