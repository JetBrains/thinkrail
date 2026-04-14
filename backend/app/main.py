from __future__ import annotations

import asyncio
import json
import logging
import sys
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

import pathspec

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.core.config import get_data_dir
from app.core.server_store import ServerStore
from app.rpc.auth import authenticate_rest, UserIdentity
from app.rpc.server import register_routes


def _find_frontend_dist() -> Path | None:
    """Locate the built frontend dist directory.

    In frozen (PyInstaller) mode, frontend files are bundled as data.
    In dev mode, check if a production build exists alongside the backend.
    """
    if getattr(sys, 'frozen', False):
        dist = Path(getattr(sys, '_MEIPASS', '')) / "frontend_dist"
    else:
        dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return dist if dist.is_dir() else None


class _SetupBody(BaseModel):
    userId: str
    name: str


class _InitBody(BaseModel):
    path: str


class _WriteFileBody(BaseModel):
    project: str
    path: str
    content: str


class _OpenExternalBody(BaseModel):
    project: str
    path: str
    editor: str


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
    """Load .bonsaihide from the project root, falling back to built-in defaults."""
    hide_file = root / ".bonsaihide"
    try:
        text = hide_file.read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        text = _BONSAIHIDE_DEFAULTS
    return pathspec.PathSpec.from_lines("gitwildmatch", text.splitlines())


def create_app() -> FastAPI:
    """Create and configure the Bonsai FastAPI application."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")

    # Server-wide store — shared across the entire app lifetime
    server_store = ServerStore(get_data_dir())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Open the server-wide SQLite store
        await server_store.open()

        # Auto-purge: run once on startup, then hourly in the background
        purge_task: asyncio.Task[None] | None = None

        async def _purge_loop() -> None:
            from app.core.config import load_config
            from app.core.settings import load_settings
            from app.trash.service import TrashService

            while True:
                try:
                    cfg = load_config()
                    settings = load_settings(cfg.get_project_root())
                    days = settings.trash_retention_days
                    if days and days > 0:
                        svc = TrashService(cfg.get_project_root())
                        svc.auto_purge(days)
                except Exception:
                    logging.getLogger(__name__).debug("Auto-purge tick failed", exc_info=True)
                await asyncio.sleep(3600)  # hourly

        purge_task = asyncio.create_task(_purge_loop())
        try:
            yield
        finally:
            if purge_task:
                purge_task.cancel()
            await server_store.close()

    app = FastAPI(title="Bonsai", lifespan=lifespan)

    # CORS — allow frontend dev server on different port
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register WebSocket endpoint (per-connection project scoping)
    register_routes(app, server_store=server_store)

    # ── Helper: resolve token from REST request ──

    async def _resolve_user(token: str | None) -> UserIdentity | None:
        return await authenticate_rest(server_store, token)

    # ── REST: First-user bootstrap (no auth required) ──

    @app.get("/api/setup/status")
    async def setup_status():
        count = await server_store.user_count()
        return {"needsSetup": count == 0}

    @app.post("/api/setup")
    async def setup_first_user(body: _SetupBody):
        from fastapi.responses import JSONResponse

        count = await server_store.user_count()
        if count > 0:
            return JSONResponse(status_code=403, content={"error": "Setup already completed"})
        user = await server_store.create_user(body.userId, body.name, is_admin=True)
        token = await server_store.create_token(body.userId)
        return {"userId": user.id, "displayName": user.display_name, "token": token}

    # ── REST: User profile & preferences (pre-WebSocket) ──

    @app.get("/api/user/profile")
    async def get_user_profile(token: str = Query(...)):
        identity = await _resolve_user(token)
        if identity is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"error": "Invalid token"})
        user = await server_store.get_user(identity.user_id)
        return {
            "userId": user.id if user else identity.user_id,
            "displayName": user.display_name if user else identity.display_name,
            "isAdmin": user.is_admin if user else identity.is_admin,
            "createdAt": user.created_at if user else None,
        }

    @app.get("/api/user/preferences")
    async def get_user_preferences(token: str = Query(...)):
        identity = await _resolve_user(token)
        if identity is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"error": "Invalid token"})
        prefs = await server_store.get_preferences(identity.user_id)
        return prefs

    @app.put("/api/user/preferences")
    async def update_user_preferences(token: str = Query(...), patch: dict | None = None):
        identity = await _resolve_user(token)
        if identity is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"error": "Invalid token"})
        result = await server_store.update_preferences(identity.user_id, patch or {})
        return result

    @app.get("/api/user/recent-projects")
    async def get_user_recent_projects(token: str = Query(...), limit: int = Query(default=10)):
        identity = await _resolve_user(token)
        if identity is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"error": "Invalid token"})
        recents = await server_store.get_recent_projects(identity.user_id, limit=limit)
        return [
            {"path": r.project_path, "name": r.name, "lastOpened": r.last_opened}
            for r in recents
        ]

    @app.get("/api/projects/known")
    async def get_known_projects(token: str = Query(...)):
        identity = await _resolve_user(token)
        if identity is None:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=401, content={"error": "Invalid token"})
        projects = await server_store.list_projects()
        return [
            {
                "path": p.path,
                "name": p.name,
                "registeredAt": p.registered_at,
                "lastOpenedAt": p.last_opened_at,
            }
            for p in projects
        ]

    # ── REST: Health check ──

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "version": "1.0.0"}

    # ── REST: Project management ──

    @app.get("/api/project/list")
    async def list_projects(base: str = Query(default=""), max_depth: int = Query(default=4)):
        """List directories containing .bonsai/registry.json.

        Scans the home directory (up to max_depth levels deep) for Bonsai projects.
        Optionally accepts a base directory to scan instead.
        """
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

    @app.get("/api/project/validate")
    async def validate_project(path: str = Query(...)):
        p = Path(path).expanduser().resolve()
        has_specs = (p / ".bonsai" / "registry.json").is_file()
        return {
            "valid": has_specs,
            "path": str(p),
            "name": p.name,
            "exists": p.is_dir(),
        }

    @app.post("/api/project/init")
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

    @app.get("/api/project/files")
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

    # ── REST: File read/write/open ──

    @app.get("/api/file/read")
    async def read_file(project: str = Query(...), path: str = Query(...)):
        """Read a file's contents. Path is relative to project root."""
        root = Path(project).expanduser().resolve()
        file_path = root / path
        if not file_path.is_file():
            return {"error": "File not found", "path": path}
        try:
            content = file_path.read_text(encoding="utf-8")
            return {
                "content": content,
                "path": path,
                "name": file_path.name,
                "size": file_path.stat().st_size,
            }
        except UnicodeDecodeError:
            return {"error": "Binary file — cannot display", "path": path}
        except Exception as e:
            return {"error": str(e), "path": path}

    @app.get("/api/file/raw")
    async def read_file_raw(project: str = Query(...), path: str = Query(...)):
        """Serve a file's raw content with appropriate content type (for images etc.)."""
        from fastapi.responses import FileResponse
        p = Path(path)
        file_path = p if p.is_absolute() else Path(project).expanduser().resolve() / path
        if not file_path.is_file():
            return {"error": "File not found"}
        return FileResponse(file_path)

    @app.post("/api/file/browse")
    async def browse_files():
        """Open a native file dialog and return selected absolute paths."""
        import asyncio
        import os
        import shutil
        import subprocess

        def _pick() -> list[str]:
            env = {**os.environ}
            # Ensure DISPLAY is set for X11 dialogs
            if "DISPLAY" not in env:
                env["DISPLAY"] = ":0"

            # Try zenity (GTK), then kdialog (KDE), then tkinter as fallback
            zenity = shutil.which("zenity")
            if zenity:
                result = subprocess.run(
                    [zenity, "--file-selection", "--multiple", "--separator=\n",
                     "--title=Select files to attach"],
                    capture_output=True, text=True, env=env,
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip().split("\n")
                return []

            kdialog = shutil.which("kdialog")
            if kdialog:
                result = subprocess.run(
                    [kdialog, "--getopenfilename", ".", "--multiple",
                     "--title", "Select files to attach"],
                    capture_output=True, text=True, env=env,
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip().split("\n")
                return []

            # Fallback to tkinter
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                paths = filedialog.askopenfilenames(title="Select files to attach")
                root.destroy()
                return list(paths)
            except Exception:
                return []

        try:
            loop = asyncio.get_running_loop()
            paths = await loop.run_in_executor(None, _pick)
            return {"paths": paths}
        except Exception as exc:
            return {"paths": [], "error": str(exc)}

    @app.post("/api/file/write")
    async def write_file(body: _WriteFileBody):
        """Write content to a file. Path is relative to project root."""
        root = Path(body.project).expanduser().resolve()
        file_path = root / body.path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(body.content, encoding="utf-8")
        return {"ok": True, "path": body.path}

    @app.post("/api/file/open-external")
    async def open_external(body: _OpenExternalBody):
        """Open a file in an external editor."""
        import subprocess, os
        root = Path(body.project).expanduser().resolve()
        file_path = root / body.path
        cmd = body.editor

        # Terminal-based editors need a terminal emulator window
        terminal_editors = {"vim", "nvim", "nano", "vi"}
        if cmd in terminal_editors:
            # Try common terminal emulators in order of preference
            terminal_cmds = [
                # $TERMINAL env var (user's preferred terminal)
                (os.environ.get("TERMINAL", ""), "-e"),
                ("kitty", "-e"),
                ("alacritty", "-e"),
                ("wezterm", "start", "--"),
                ("gnome-terminal", "--"),
                ("konsole", "-e"),
                ("xfce4-terminal", "-e"),
                ("xterm", "-e"),
            ]
            for term_entry in terminal_cmds:
                term = term_entry[0]
                if not term:
                    continue
                args = list(term_entry[1:])
                try:
                    subprocess.Popen(
                        [term, *args, cmd, str(file_path)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    return {"ok": True, "terminal": term}
                except FileNotFoundError:
                    continue
            return {"error": f"No terminal emulator found to run '{cmd}'"}
        else:
            try:
                subprocess.Popen([cmd, str(file_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return {"ok": True}
            except FileNotFoundError:
                return {"error": f"'{cmd}' not found in PATH"}

    # ── REST: Filesystem autocomplete ──

    @app.get("/api/fs/list-dirs")
    async def list_dirs(base: str = Query(...), prefix: str = Query("")):
        """List subdirectories of `base` matching `prefix`. For path autocompletion."""
        base_path = Path(base).expanduser().resolve()
        if not base_path.is_dir():
            return {"dirs": []}
        try:
            entries = sorted(base_path.iterdir(), key=lambda p: p.name.lower())
        except PermissionError:
            return {"dirs": []}
        dirs = []
        for entry in entries:
            if not entry.is_dir():
                continue
            if entry.name.startswith("."):
                continue
            if prefix and not entry.name.lower().startswith(prefix.lower()):
                continue
            dirs.append(str(entry) + "/")
            if len(dirs) >= 20:
                break
        return {"dirs": dirs}

    @app.get("/api/fs/browse")
    async def browse_folder():
        """Open a native OS folder picker dialog and return the selected path."""
        import asyncio
        import sys

        if sys.platform == "darwin":
            script = 'POSIX path of (choose folder with prompt "Select project folder")'
            try:
                proc = await asyncio.create_subprocess_exec(
                    "osascript", "-e", script,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await proc.communicate()
                if proc.returncode == 0:
                    selected = stdout.decode().strip()
                    return {"path": selected}
                return {"path": None}
            except Exception as e:
                return {"error": str(e)}
        else:
            return {"error": "Native folder picker not supported on this platform"}

    # Serve bundled frontend if available (production/packaged mode).
    # Mounted last so /ws, /api/*, and other explicit routes take priority.
    frontend_dist = _find_frontend_dist()
    if frontend_dist:
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    return app


if __name__ == "__main__":
    import uvicorn
    from app.core.config import ServerSettings

    srv = ServerSettings()
    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=srv.backend_host,
        port=srv.backend_port,
    )
