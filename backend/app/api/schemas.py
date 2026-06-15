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


# ── project scan (onboarding) ────────────────────────────────────────────────

class ScanFile(BaseModel):
    """A high-signal file found at the project root."""

    name: str
    size: int
    description: str


class ScanFolder(BaseModel):
    """A top-level directory inside the project root."""

    name: str
    entry_count: int


class ScanEngineGuidance(BaseModel):
    """Per-engine guidance-file probe result.

    Each ``IAgentRuntime`` declares the repo-root file it expects to
    read (e.g. ``CLAUDE.md``) and the shell command that creates it.
    The onboarding scanner reports whether that file is present so the
    UI can prompt the user to run the init command if not.
    """

    engine: str
    display_name: str
    file: str
    found: bool
    init_command: str | None = None


class ProjectScanResponse(BaseModel):
    important_files: list[ScanFile]
    top_folders: list[ScanFolder]
    engine_guidance: list[ScanEngineGuidance]


class InitEngineRequest(BaseModel):
    """Body of ``POST /api/project/init-engine``."""

    engine: str
    path: str


class InitEngineResponse(BaseModel):
    """Result of writing an engine's guidance template."""

    ok: bool = True
    # ``False`` when the file already existed and we left it alone.
    created: bool
    file: str
    init_command: str | None = None


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


class DefaultRootResponse(BaseModel):
    root: str


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
