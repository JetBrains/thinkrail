from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL_CONFIG = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

MetaTicketStatus = Literal[
    "idea",
    "specified",
    "planned",
    "executing",
    "done",
]

MetaTicketType = Literal["feature", "bug", "idea", "improvement"]


def _make_id() -> str:
    return f"mt_{secrets.token_hex(4)}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class MetaTicket(BaseModel):
    """A meta-ticket representing an idea, feature, bug, or improvement."""

    model_config = _CAMEL_CONFIG

    id: str = Field(default_factory=_make_id)
    title: str
    body: str = ""
    status: MetaTicketStatus = "idea"
    type: MetaTicketType = "feature"
    plan_path: str | None = None
    orchestrator_session_id: str | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = Field(default_factory=_now_iso)
    updated: str = Field(default_factory=_now_iso)


class MetaTicketSummary(BaseModel):
    """Lightweight listing model (no body) for the board view."""

    model_config = _CAMEL_CONFIG

    id: str
    title: str
    status: MetaTicketStatus
    type: MetaTicketType
    plan_path: str | None = None
    orchestrator_session_id: str | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = ""
    updated: str = ""
