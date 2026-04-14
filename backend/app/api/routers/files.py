"""REST endpoints for file read/write/open operations.

Path traversal protection is enforced via ``valid_file_in_project`` on all
endpoints that accept a relative ``path`` parameter.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.deps import valid_file_in_project
from app.api.schemas import FileBrowseResponse, FileReadResponse, FileWriteResponse, OpenExternalResponse

router = APIRouter(prefix="/api/file", tags=["files"])

_FilePair = Annotated[tuple[Path, Path], Depends(valid_file_in_project)]


class _WriteFileBody(BaseModel):
    project: str
    path: str
    content: str


class _OpenExternalBody(BaseModel):
    project: str
    path: str
    editor: str


@router.get("/read", response_model=FileReadResponse)
async def read_file(paths: _FilePair) -> FileReadResponse:
    """Read a text file's contents. Path is relative to project root."""
    root, file_path = paths
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = file_path.read_text(encoding="utf-8")
        return FileReadResponse(
            content=content,
            path=str(file_path.relative_to(root)),
            name=file_path.name,
            size=file_path.stat().st_size,
        )
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Binary file — cannot display")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/raw")
async def read_file_raw(project: str = Query(...), path: str = Query(...)):
    """Serve a file's raw content with appropriate content type (for images etc.).

    Accepts absolute paths for cases where the agent produces files outside the
    project tree (e.g. temporary screenshot files).  Relative paths are resolved
    inside the project root without traversal validation so they are safe.
    """
    p = Path(path)
    if p.is_absolute():
        file_path = p
    else:
        root = Path(project).expanduser().resolve()
        file_path = (root / path).resolve()
        if not file_path.is_relative_to(root):
            raise HTTPException(status_code=400, detail="Path traversal detected")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


@router.post("/browse", response_model=FileBrowseResponse)
async def browse_files() -> FileBrowseResponse:
    """Open a native file dialog and return selected absolute paths."""

    def _pick() -> list[str]:
        env = {**os.environ}
        if "DISPLAY" not in env:
            env["DISPLAY"] = ":0"

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
        return FileBrowseResponse(paths=paths)
    except Exception as exc:
        return FileBrowseResponse(paths=[], error=str(exc))


@router.post("/write", response_model=FileWriteResponse)
async def write_file(body: _WriteFileBody) -> FileWriteResponse:
    """Write content to a file. Path is relative to project root."""
    root = Path(body.project).expanduser().resolve()
    file_path = (root / body.path).resolve()
    if not file_path.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(body.content, encoding="utf-8")
    return FileWriteResponse(path=body.path)


@router.post("/open-external", response_model=OpenExternalResponse)
async def open_external(body: _OpenExternalBody) -> OpenExternalResponse:
    """Open a file in an external editor."""
    root = Path(body.project).expanduser().resolve()
    file_path = (root / body.path).resolve()
    if not file_path.is_relative_to(root):
        raise HTTPException(status_code=400, detail="Path traversal detected")
    cmd = body.editor

    terminal_editors = {"vim", "nvim", "nano", "vi"}
    if cmd in terminal_editors:
        terminal_cmds = [
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
                return OpenExternalResponse(terminal=term)
            except FileNotFoundError:
                continue
        raise HTTPException(status_code=500, detail=f"No terminal emulator found to run '{cmd}'")
    else:
        try:
            subprocess.Popen([cmd, str(file_path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return OpenExternalResponse()
        except FileNotFoundError:
            raise HTTPException(status_code=400, detail=f"'{cmd}' not found in PATH")
