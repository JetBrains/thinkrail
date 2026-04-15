"""REST endpoints for filesystem utilities (directory listing, mkdir, folder picker)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.schemas import DirListResponse, FolderPickResponse, OkResponse

router = APIRouter(prefix="/api/fs", tags=["fs"])


class _MkdirBody(BaseModel):
    path: str


@router.get("/list-dirs", response_model=DirListResponse)
async def list_dirs(base: str = Query(...), prefix: str = Query("")) -> DirListResponse:
    """List subdirectories of *base* matching *prefix*. For path autocompletion."""
    base_path = Path(base).expanduser().resolve()
    if not base_path.is_dir():
        return DirListResponse(dirs=[])
    try:
        entries = sorted(base_path.iterdir(), key=lambda p: p.name.lower())
    except PermissionError:
        return DirListResponse(dirs=[])
    dirs: list[str] = []
    for entry in entries:
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        if prefix and not entry.name.lower().startswith(prefix.lower()):
            continue
        dirs.append(str(entry) + "/")
        if len(dirs) >= 20:
            break
    return DirListResponse(dirs=dirs)


@router.post("/mkdir", response_model=OkResponse)
async def make_directory(body: _MkdirBody) -> OkResponse:
    """Create a directory (and parents) at the given path."""
    target = body.path.strip()
    if not target:
        raise HTTPException(status_code=400, detail="Path is required")
    try:
        Path(target).mkdir(parents=True, exist_ok=True)
        return OkResponse()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/browse", response_model=FolderPickResponse)
async def browse_folder() -> FolderPickResponse:
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
                return FolderPickResponse(path=stdout.decode().strip())
            return FolderPickResponse()
        except Exception as e:
            return FolderPickResponse(error=str(e))
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
                    return FolderPickResponse(path=stdout.decode().strip())
            except FileNotFoundError:
                continue
        return FolderPickResponse(error="No folder picker available. Install zenity or kdialog.")
    else:
        return FolderPickResponse(error="Native folder picker not supported on this platform")
