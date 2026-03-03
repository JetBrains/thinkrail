from __future__ import annotations

import json
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.rpc.server import register_routes


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


def create_app() -> FastAPI:
    """Create and configure the Bonsai FastAPI application."""

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
        has_specs = (p / ".specs" / "registry.json").is_file()
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
        specs_dir = p / ".specs"
        specs_dir.mkdir(exist_ok=True)
        registry = specs_dir / "registry.json"
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
    async def list_files(path: str = Query(...), max_depth: int = Query(10)):
        """List project directory tree (files and folders)."""
        root = Path(path).expanduser().resolve()
        if not root.is_dir():
            return {"entries": []}

        IGNORE = {
            "node_modules", ".venv", "__pycache__", ".git", ".claude",
            "dist", ".vite", ".mypy_cache", ".pytest_cache", ".ruff_cache",
            "target", "build", ".next", ".nuxt",
        }

        entries: list[dict] = []

        def walk(dir_path: Path, depth: int) -> None:
            if depth > max_depth:
                return
            try:
                children = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
            except PermissionError:
                return
            for child in children:
                if child.name.startswith(".") and child.name not in (".specs",):
                    continue
                if child.name in IGNORE:
                    continue
                rel = str(child.relative_to(root))
                is_dir = child.is_dir()
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

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
    )
