from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL_CONFIG = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

TicketStatus = Literal[
    "idea",
    "product-design",
    "technical-design",
    "amend-specs",
    "implementation-plan",
    "implementing",
    "done",
]

TicketType = Literal["feature", "bug", "idea", "improvement"]

ArtifactKind = Literal[
    "product_design",
    "technical_design",
    "history",
    "implementation_plan",
]


def _make_id() -> str:
    return f"mt_{secrets.token_hex(4)}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Ticket(BaseModel):
    """A meta-ticket representing an idea, feature, bug, or improvement."""

    model_config = _CAMEL_CONFIG

    id: str = Field(default_factory=_make_id)
    title: str
    body: str = ""
    status: TicketStatus = "idea"
    type: TicketType = "feature"

    # ── Artifact paths (relative to project root) ─────────────────
    product_design_path: str | None = None
    technical_design_path: str | None = None
    history_path: str | None = None
    implementation_plan_path: str | None = None

    # ── Staleness flags ─────────────────────────────────────────
    technical_design_stale: bool = False
    history_stale: bool = False
    implementation_plan_stale: bool = False

    # ── Existing fields ─────────────────────────────────────────
    orchestrator_session_id: str | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = Field(default_factory=_now_iso)
    updated: str = Field(default_factory=_now_iso)

    # ── Skipped phases (set by user via vertical phase list) ────
    skipped_phases: list[TicketStatus] = Field(default_factory=list)


class TicketSummary(BaseModel):
    """Lightweight listing model (no body) for the board view."""

    model_config = _CAMEL_CONFIG

    id: str
    title: str
    status: TicketStatus
    type: TicketType

    product_design_path: str | None = None
    technical_design_path: str | None = None
    history_path: str | None = None
    implementation_plan_path: str | None = None

    technical_design_stale: bool = False
    history_stale: bool = False
    implementation_plan_stale: bool = False

    orchestrator_session_id: str | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = ""
    updated: str = ""
    skipped_phases: list[TicketStatus] = Field(default_factory=list)

    @classmethod
    def from_ticket(cls, ticket: Ticket) -> TicketSummary:
        """Build a summary from a full ticket, computing derived fields."""
        return cls(
            id=ticket.id,
            title=ticket.title,
            status=ticket.status,
            type=ticket.type,
            product_design_path=ticket.product_design_path,
            technical_design_path=ticket.technical_design_path,
            history_path=ticket.history_path,
            implementation_plan_path=ticket.implementation_plan_path,
            technical_design_stale=ticket.technical_design_stale,
            history_stale=ticket.history_stale,
            implementation_plan_stale=ticket.implementation_plan_stale,
            orchestrator_session_id=ticket.orchestrator_session_id,
            linked_spec_ids=ticket.linked_spec_ids,
            session_ids=ticket.session_ids,
            order=ticket.order,
            created=ticket.created,
            updated=ticket.updated,
            skipped_phases=list(ticket.skipped_phases),
        )
