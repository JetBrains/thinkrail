"""Claude model registry — loads the curated catalog shipped with the package."""

from __future__ import annotations

import json
from importlib.resources import files

from app.agent.runtime.types import LabeledOption


class ClaudeModelRegistry:
    def __init__(self) -> None:
        raw = json.loads(
            files(__package__).joinpath("models.json").read_text(encoding="utf-8")
        )
        self._options: tuple[LabeledOption, ...] = tuple(
            LabeledOption(value=row["id"], label=row["label"]) for row in raw
        )

    def list_options(self) -> list[LabeledOption]:
        return list(self._options)
