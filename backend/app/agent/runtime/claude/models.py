"""Claude model registry — loads the curated catalog shipped with the package."""

from __future__ import annotations

import json
from importlib.resources import files

from app.agent.runtime.types import DEFAULT_CONTEXT_WINDOW, ModelInfo


class ClaudeModelRegistry:
    def __init__(self) -> None:
        raw = json.loads(
            files(__package__).joinpath("models.json").read_text(encoding="utf-8")
        )
        self._models: tuple[ModelInfo, ...] = tuple(
            ModelInfo(id=row["id"], label=row["label"], context_window=row["contextWindow"])
            for row in raw
        )
        self._by_id: dict[str, ModelInfo] = {m.id: m for m in self._models}

    def list_models(self) -> list[ModelInfo]:
        return list(self._models)

    def get_context_window(self, model_id: str) -> int:
        hit = self._by_id.get(model_id)
        return hit.context_window if hit is not None else DEFAULT_CONTEXT_WINDOW
