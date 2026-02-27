from __future__ import annotations

import json
from pathlib import Path

from app.core.fileio import read_text
from app.spec.models import Spec


def parse_spec(path: Path) -> Spec:
    """Read a spec file from disk and return a :class:`Spec`.

    Format is detected by file extension:
    - ``.md`` → Markdown (metadata is ``None``)
    - ``.json`` → JSON (metadata is the parsed dict)

    Raises ``FileNotFoundError`` if the file does not exist.
    Raises ``ValueError`` for unsupported extensions or malformed JSON.
    """
    content = read_text(path)
    suffix = path.suffix.lower()

    if suffix in (".md", ".txt"):
        return Spec(type=_type_from_path(path), content=content, metadata=None)
    elif suffix == ".json":
        try:
            metadata = json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Malformed JSON in {path}: {exc}") from exc
        return Spec(type=_type_from_path(path), content=content, metadata=metadata)
    else:
        raise ValueError(f"Unsupported spec file extension: {suffix}")


def _type_from_path(path: Path) -> str:
    """Derive a spec type hint from the file name."""
    name = path.stem.lower()
    if name == "readme":
        return "module-design"
    return name
