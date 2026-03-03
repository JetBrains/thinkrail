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
    async def list_files(path: str = Query(...), max_depth: int = Query(4)):
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

    return app


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
    )
