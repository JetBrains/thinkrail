"""REST endpoints for filesystem utilities (directory listing, mkdir, folder picker)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/api/fs")


class _MkdirBody(BaseModel):
    path: str


@router.get("/list-dirs")
async def list_dirs(base: str = Query(...), prefix: str = Query("")):
    """List subdirectories of *base* matching *prefix*. For path autocompletion."""
    base_path = Path(base).expanduser().resolve()
    if not base_path.is_dir():
        return {"dirs": []}
    try:
        entries = sorted(base_path.iterdir(), key=lambda p: p.name.lower())
    except PermissionError:
        return {"dirs": []}
    dirs: list[str] = []
    for entry in entries:
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if prefix and not entry.name.lower().startswith(prefix.lower()):
            continue
        dirs.append(str(entry) + "/")
        if len(dirs) >= 20:
            break
    return {"dirs": dirs}


@router.post("/mkdir")
async def make_directory(body: _MkdirBody):
    """Create a directory (and parents) at the given path."""
    target = body.path.strip()
    if not target:
        return {"error": "Path is required"}
    try:
        Path(target).mkdir(parents=True, exist_ok=True)
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


@router.get("/browse")
async def browse_folder():
    """Open a native OS folder picker dialog and return the selected path."""
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
                return {"path": stdout.decode().strip()}
            return {"path": None}
        except Exception as e:
            return {"error": str(e)}
    elif sys.platform == "linux":
        for cmd in [
            ["zenity", "--file-selection", "--directory", "--title=Select project folder"],
            ["kdialog", "--getexistingdirectory", "/", "--title", "Select project folder"],
        ]:
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await proc.communicate()
                if proc.returncode == 0:
                    return {"path": stdout.decode().strip()}
            except FileNotFoundError:
                continue
        return {"error": "No folder picker available. Install zenity or kdialog."}
    else:
        return {"error": "Native folder picker not supported on this platform"}
