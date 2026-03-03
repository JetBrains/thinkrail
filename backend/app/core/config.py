from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel


class AppConfig(BaseModel):
    project_root: Path
    spec_dir: Path
    plugin_dir: Path
    host: str = "127.0.0.1"
    port: int = 8000

    def get_project_root(self) -> Path:
        """Return the project root directory."""
        return self.project_root

    def get_spec_dir(self) -> Path:
        """Return the path to the ``.specs/`` directory."""
        return self.spec_dir

    def get_registry_path(self) -> Path:
        """Return the path to ``.specs/registry.json``."""
        return self.spec_dir / "registry.json"

# Bonsai repo root: backend/app/core/config.py → ../../.. → bonsai/
_BONSAI_ROOT = Path(__file__).resolve().parent.parent.parent.parent


def _discover_root() -> Path:
    """Walk upward from cwd looking for a ``.specs/`` directory."""
    current = Path.cwd().resolve()
    for parent in [current, *current.parents]:
        if (parent / ".specs").is_dir():
            return parent
    return current


def load_config(project_root: Path | None = None) -> AppConfig:
    """Build an ``AppConfig`` from the given project root."""
    root = project_root or _discover_root()
    return AppConfig(
        project_root=root,
        spec_dir=root / ".specs",
        plugin_dir=_BONSAI_ROOT / "claude-plugin",
    )
