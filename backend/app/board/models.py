from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from app.board.work_node import WorkNode


def _to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL_CONFIG = ConfigDict(alias_generator=_to_camel, populate_by_name=True)

TicketType = Literal["feature", "bug", "idea", "improvement"]

ArtifactKind = Literal[
    "product_design",
    "technical_design",
    "history",
    "implementation_plan",
]

Lifecycle = Literal["created", "design", "implementation", "done"]


def _make_id() -> str:
    return f"mt_{secrets.token_hex(4)}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class OrchestrationConfig(BaseModel):
    """Per-ticket orchestration gates + failure policy (see design §3)."""

    model_config = _CAMEL_CONFIG

    stage_gate: Literal["approve", "autonomous"] = "approve"
    step_gate: Literal["approve", "autonomous"] = "approve"
    failure_policy: Literal["fail-fast", "wait-all"] = "fail-fast"
    step_execution: Literal["interactive", "subagent"] = "interactive"


class OrchestratorRef(BaseModel):
    """Reference to a ticket's orchestrator driver. ``kind="session"`` points at a
    Session via ``session_id``; ``kind="builtin"`` names a registered pipeline via
    ``builtin_id``. See SESSION_TICKET_MODEL.md §"The orchestrator"."""

    model_config = _CAMEL_CONFIG

    kind: Literal["session", "builtin"] = "session"
    session_id: str | None = None
    builtin_id: str | None = None


class Ticket(BaseModel):
    """A meta-ticket. Progress is driven by the ``stages`` DAG (``WorkNode``);
    ``lifecycle`` is derived from the stages for the board (see work_node)."""

    model_config = _CAMEL_CONFIG

    id: str = Field(default_factory=_make_id)
    title: str
    body: str = ""
    type: TicketType = "feature"

    # ── Stage DAG (orchestration blueprint + history) ─────────────
    stages: list["WorkNode"] = Field(default_factory=list)
    orchestration: OrchestrationConfig = Field(default_factory=OrchestrationConfig)

    # ── Artifact paths (relative to project root) ─────────────────
    product_design_path: str | None = None
    technical_design_path: str | None = None
    history_path: str | None = None
    implementation_plan_path: str | None = None

    # ── Existing fields ─────────────────────────────────────────
    orchestrator: OrchestratorRef | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = Field(default_factory=_now_iso)
    updated: str = Field(default_factory=_now_iso)
    rev: int = 0

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_orchestrator(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        if "orchestrator" not in data:
            legacy = data.get("orchestratorSessionId") or data.get("orchestrator_session_id")
            if legacy:
                data = dict(data)
                data["orchestrator"] = {"kind": "session", "sessionId": legacy}
        return data


class TicketSummary(BaseModel):
    """Lightweight listing model (no body / no stages) for the board view."""

    model_config = _CAMEL_CONFIG

    id: str
    title: str
    type: TicketType
    lifecycle: Lifecycle = "created"

    product_design_path: str | None = None
    technical_design_path: str | None = None
    history_path: str | None = None
    implementation_plan_path: str | None = None

    orchestrator: OrchestratorRef | None = None
    linked_spec_ids: list[str] = Field(default_factory=list)
    session_ids: list[str] = Field(default_factory=list)
    order: int = 0
    created: str = ""
    updated: str = ""
    rev: int = 0

    @classmethod
    def from_ticket(cls, ticket: Ticket) -> TicketSummary:
        """Build a summary from a full ticket, computing the derived lifecycle."""
        from app.board.work_node import derive_lifecycle

        return cls(
            id=ticket.id,
            title=ticket.title,
            type=ticket.type,
            lifecycle=derive_lifecycle(ticket.stages),
            product_design_path=ticket.product_design_path,
            technical_design_path=ticket.technical_design_path,
            history_path=ticket.history_path,
            implementation_plan_path=ticket.implementation_plan_path,
            orchestrator=ticket.orchestrator,
            linked_spec_ids=ticket.linked_spec_ids,
            session_ids=ticket.session_ids,
            order=ticket.order,
            created=ticket.created,
            updated=ticket.updated,
            rev=ticket.rev,
        )


from app.board.work_node import WorkNode  # noqa: E402

Ticket.model_rebuild()
