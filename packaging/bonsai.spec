# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Bonsai standalone executable.

Build:
    cd packaging && pyinstaller bonsai.spec

Produces:
    dist/bonsai          (onefile executable)
    dist/bonsai-dir/     (directory bundle, faster startup)
"""
from PyInstaller.utils.hooks import collect_data_files, collect_submodules
import os

# -- Gather hidden imports for packages that use dynamic loading --
hiddenimports = [
    # uvicorn dynamically loads protocol implementations
    *collect_submodules('uvicorn'),
    # pydantic uses Rust-backed pydantic_core
    *collect_submodules('pydantic'),
    *collect_submodules('pydantic_core'),
    # fastapi routing internals
    *collect_submodules('fastapi'),
    # starlette (used by fastapi for static files, websockets, etc.)
    *collect_submodules('starlette'),
    # jsonrpcserver dispatches methods dynamically
    *collect_submodules('jsonrpcserver'),
    # anthropic + claude-agent-sdk
    *collect_submodules('anthropic'),
    *collect_submodules('claude_agent_sdk'),
    # httpx is needed by mcp (transitive dep of claude-agent-sdk)
    *collect_submodules('httpx'),
    # watchfiles native component
    'watchfiles',
    'watchfiles._rust_notify',
    # pydantic-settings for .env loading
    *collect_submodules('pydantic_settings'),
    # pathspec for .bonsaihide
    'pathspec',
    # explicit app modules (PyInstaller traces these, but be safe)
    *collect_submodules('app'),
]

# -- Data files --
frontend_dist = os.path.join('..', 'frontend', 'dist')

a = Analysis(
    ['entry.py'],
    pathex=[os.path.join('..', 'backend')],
    binaries=[],
    datas=[
        (frontend_dist, 'frontend_dist'),
        *collect_data_files('claude_agent_sdk'),   # includes _bundled/claude CLI
        ('../claude-plugin', 'claude-plugin'),       # bonsai agent plugin
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude test/dev-only packages to reduce size
        'pytest',
        'pytest_asyncio',
        'tkinter',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

# ── Single-file executable ──
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='bonsai',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

# ── Directory bundle (faster startup) ──
exe_dir = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='bonsai',
    debug=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe_dir,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    name='bonsai-dir',
)
