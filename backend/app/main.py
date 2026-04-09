from __future__ import annotations

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

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield

    app = FastAPI(title="Bonsai", lifespan=lifespan)

    # CORS — allow frontend dev server on different port
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register WebSocket endpoint (per-connection project scoping)
    register_routes(app)

    # ── REST: Project management ──

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
