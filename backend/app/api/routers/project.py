"""REST endpoints for project management and health check."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from app.agent.available_runtimes import AVAILABLE_RUNTIME_CLASSES
from app.api.schemas import (
    FileEntry,
    HealthResponse,
    InitEngineRequest,
    InitEngineResponse,
    ProjectFilesResponse,
    ProjectInfo,
    ProjectListResponse,
    ProjectScanResponse,
    ProjectState,
    ProjectValidateResponse,
    ScanEngineGuidance,
    ScanFile,
    ScanFolder,
)
from app.core.thinkrailhide import load_thinkrailhide
from app.version import VERSION
from app.core.config import PROJECT_DIRNAME
from app.spec.service import SPEC_FILENAME_MAP

router = APIRouter(tags=["project"])


# Spec deliverables split by onboarding stage, derived from
# SPEC_FILENAME_MAP so the markers stay in sync with what the agent's
# spec_save tool writes. GOAL&REQUIREMENTS is the FIRST artifact the
# onboarding flow produces — on its own it means the user is still
# mid-onboarding, so it leaves the project "existing" (the investigate
# flow re-reads it) rather than "initialized". Later deliverables (the
# design doc) — plus board tickets and saved plans — mean real work has
# happened and the session should just be restored.
_INITIAL_SPEC_TYPES: frozenset[str] = frozenset({"goal-and-requirements"})
_INITIAL_SPEC_MARKERS: frozenset[str] = frozenset(
    name for name, spec_type in SPEC_FILENAME_MAP.items() if spec_type in _INITIAL_SPEC_TYPES
)
_DELIVERABLE_MARKERS: frozenset[str] = frozenset(
    name for name, spec_type in SPEC_FILENAME_MAP.items() if spec_type not in _INITIAL_SPEC_TYPES
)


def _is_nonempty_file(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def _has_marker(children: list[Path], markers: frozenset[str]) -> bool:
    """True if any child is a non-empty file whose name is in ``markers``."""
    return any(c.name in markers and _is_nonempty_file(c) for c in children)


def _project_meta_dir(p: Path) -> Path | None:
    """Return the project's ``.tr`` meta dir, or ``None`` if absent."""
    meta = p / PROJECT_DIRNAME
    if meta.is_dir():
        return meta
    return None


def _thinkrail_has_deliverable(meta: Path | None) -> bool:
    """True if the meta dir holds real work past the initial goal spec —
    a later spec deliverable, a board ticket, or a saved plan.

    The agent writes most artifacts inside the meta dir rather than the
    project root. A bare ``sessions`` directory doesn't count — it can be
    left behind by a draft that never produced anything.
    """
    if meta is None:
        return False
    try:
        if any(_is_nonempty_file(meta / marker) for marker in _DELIVERABLE_MARKERS):
            return True
        mt_dir = meta / "meta-tickets"
        if mt_dir.is_dir() and any(mt_dir.glob("*.json")):
            return True
        plans_dir = meta / "plans"
        if plans_dir.is_dir() and any(plans_dir.iterdir()):
            return True
    except OSError:
        return False
    return False


def _thinkrail_has_goal(meta: Path | None) -> bool:
    """True if an initial goal&requirements spec lives inside ``.tr/``."""
    if meta is None:
        return False
    return any(_is_nonempty_file(meta / marker) for marker in _INITIAL_SPEC_MARKERS)


def _detect_project_state(p: Path) -> ProjectState:
    """Classify a directory:
      - ``initialized``: a later spec deliverable, ticket, or plan exists
        — real work has happened, restore the session
      - ``existing``: has user files OR only an initial goal spec — keep
        onboarding via the investigate flow, which reads what's there
      - ``new``: empty workspace — show welcome

    Deliverables can live at the project root OR inside ``.tr/`` (where the
    agent typically writes them). Falls back to ``existing`` on permission
    errors — safer than pushing the user into the new-project flow on an
    unreadable directory.
    """
    try:
        non_dot = [c for c in p.iterdir() if not c.name.startswith(".")]
    except OSError:
        return "existing"

    meta = _project_meta_dir(p)
    if _has_marker(non_dot, _DELIVERABLE_MARKERS) or _thinkrail_has_deliverable(meta):
        return "initialized"
    if non_dot or _thinkrail_has_goal(meta):
        return "existing"
    return "new"


@router.get("/api/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", version=VERSION)


@router.get("/api/project/list", response_model=ProjectListResponse)
async def list_projects(base: str = Query(default=""), max_depth: int = Query(default=4)) -> ProjectListResponse:
    """List directories containing a project meta directory."""
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
            if _project_meta_dir(child) is not None:
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


# ── Project scan (onboarding) ────────────────────────────────────────────────

# Files matched case-insensitively against the project root for the
# onboarding ``what we'll read`` screen. Engine-specific guidance files
# (CLAUDE.md, AGENTS.md, etc.) live on the runtime classes — keep them
# out of this list so the scanner doesn't duplicate engine knowledge.
_IMPORTANT_FILE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("readme", "Project overview"),
    ("pyproject.toml", "Python project & dependencies"),
    ("package.json", "Node project & dependencies"),
    ("cargo.toml", "Rust project & dependencies"),
    ("go.mod", "Go module"),
    ("changelog", "Recent changes"),
    ("license", "License"),
    ("licence", "License"),
    ("dockerfile", "Container build"),
    ("docker-compose", "Container orchestration"),
)

# ``_safe_entry_count`` stops here so a generated ``src/`` of 100k files
# doesn't make the onboarding scan walk the world.
_ENTRY_COUNT_CAP = 500


def _describe_important_file(name: str) -> str | None:
    lower = name.lower()
    stem = lower.rsplit(".", 1)[0]
    for pattern, description in _IMPORTANT_FILE_PATTERNS:
        if lower == pattern or stem == pattern or lower.startswith(pattern + "."):
            return description
    return None


def _safe_file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _safe_entry_count(directory: Path) -> int:
    try:
        count = 0
        for _ in directory.iterdir():
            count += 1
            if count >= _ENTRY_COUNT_CAP:
                break
        return count
    except OSError:
        return 0


@router.get("/api/project/scan", response_model=ProjectScanResponse)
async def scan_project(path: str = Query(...)) -> ProjectScanResponse:
    """Inspect the project root for onboarding.

    Returns three groups: important files (README, pyproject.toml, …),
    top-level folders, and a guidance-file probe for each registered
    agent engine (e.g. ``CLAUDE.md`` for Claude). Engine metadata comes
    from the runtime classes themselves — see
    ``AVAILABLE_RUNTIME_CLASSES``.
    """
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        return ProjectScanResponse(important_files=[], top_folders=[], engine_guidance=[])

    spec = load_thinkrailhide(root)

    important_files: list[ScanFile] = []
    top_folders: list[ScanFolder] = []

    try:
        children = sorted(root.iterdir(), key=lambda p: p.name.lower())
    except OSError:
        children = []

    for child in children:
        rel = child.name
        is_dir = child.is_dir()
        if spec.match_file(rel + "/" if is_dir else rel):
            continue
        if is_dir:
            # ``.tr/`` is exempted by thinkrailhide's default ignore set
            # but we don't want it as an onboarding folder either.
            if rel.startswith("."):
                continue
            top_folders.append(
                ScanFolder(name=rel, entry_count=_safe_entry_count(child))
            )
        else:
            description = _describe_important_file(rel)
            if description is None:
                continue
            important_files.append(
                ScanFile(
                    name=rel,
                    size=_safe_file_size(child),
                    description=description,
                )
            )

    engine_guidance: list[ScanEngineGuidance] = []
    for runtime_cls in AVAILABLE_RUNTIME_CLASSES:
        guidance_file = getattr(runtime_cls, "guidance_file", None)
        if not guidance_file:
            continue
        engine_guidance.append(
            ScanEngineGuidance(
                engine=runtime_cls.runtime_type,
                display_name=runtime_cls.display_name,
                file=guidance_file,
                found=(root / guidance_file).is_file(),
                init_command=getattr(runtime_cls, "init_command", None),
            )
        )

    return ProjectScanResponse(
        important_files=important_files,
        top_folders=top_folders,
        engine_guidance=engine_guidance,
    )


def _find_runtime_class(engine: str) -> type:
    for cls in AVAILABLE_RUNTIME_CLASSES:
        if cls.runtime_type == engine:
            return cls
    raise HTTPException(status_code=404, detail=f"Unknown engine: {engine}")


@router.post("/api/project/init-engine", response_model=InitEngineResponse)
async def init_engine(req: InitEngineRequest) -> InitEngineResponse:
    """Bootstrap an engine's guidance file (e.g. CLAUDE.md) for a project.

    Writes the runtime's ``guidance_template`` to ``path/<guidance_file>``
    when the file is missing. Idempotent — if the file already exists,
    leaves it alone and reports ``created=false``. Engine metadata
    (filename + template) comes from the runtime class itself, so adding
    a new engine doesn't touch this endpoint.
    """
    root = Path(req.path).expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"Directory not found: {root}")

    runtime_cls = _find_runtime_class(req.engine)
    guidance_file = getattr(runtime_cls, "guidance_file", None)
    template = getattr(runtime_cls, "guidance_template", None)
    init_command = getattr(runtime_cls, "init_command", None)

    if not guidance_file:
        raise HTTPException(status_code=422, detail=f"{req.engine} has no guidance file")
    if not template:
        raise HTTPException(status_code=422, detail=f"{req.engine} has no guidance template")

    target = root / guidance_file
    try:
        with target.open("x", encoding="utf-8") as fh:
            fh.write(template)
    except FileExistsError:
        return InitEngineResponse(
            ok=True, created=False, file=guidance_file, init_command=init_command
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return InitEngineResponse(
        ok=True, created=True, file=guidance_file, init_command=init_command
    )


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

    spec = load_thinkrailhide(root)
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
