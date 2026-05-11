"""Pydantic response models for the REST API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


ProjectState = Literal["initialized", "new", "existing"]


# ── Shared ───────────────────────────────────────────────────────────────────

class OkResponse(BaseModel):
    ok: bool = True


# ── project.py ───────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str


class ProjectInfo(BaseModel):
    path: str
    name: str


class ProjectListResponse(BaseModel):
    projects: list[ProjectInfo]


class ProjectValidateResponse(BaseModel):
    state: ProjectState
    path: str
    name: str
    exists: bool


class FileEntry(BaseModel):
    path: str
    name: str
    isDir: bool
    depth: int


class ProjectFilesResponse(BaseModel):
    entries: list[FileEntry]


# ── files.py ─────────────────────────────────────────────────────────────────

class FileReadResponse(BaseModel):
    content: str
    path: str
    name: str
    size: int


class FileWriteResponse(BaseModel):
    ok: bool = True
    path: str


class FileBrowseResponse(BaseModel):
    paths: list[str]
    error: str | None = None


class OpenExternalResponse(BaseModel):
    ok: bool = True
    terminal: str | None = None
    error: str | None = None


# ── fs.py ────────────────────────────────────────────────────────────────────

class DirListResponse(BaseModel):
    dirs: list[str]


class FolderPickResponse(BaseModel):
    path: str | None = None
    error: str | None = None


# ── server_info.py ──────────────────────────────────────────────────────────

class TailscaleInfoResponse(BaseModel):
    ip: str | None = None
    hostname: str | None = None
    active: bool = False


class ServerInfoResponse(BaseModel):
    hostname: str
    lanIps: list[str]
    tailscale: TailscaleInfoResponse
    version: str
