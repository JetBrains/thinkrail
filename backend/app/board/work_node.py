"""WorkNode — the universal unit for ticket stages and plan steps.

Stages form a ticket's top-level DAG; the implementing node's ``children``
form the step sub-DAG. ``ready`` is derived (see helpers), never stored.
See TICKET_LIFECYCLE_DESIGN.md (Data model — WorkNode).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

from app.board.models import _CAMEL_CONFIG


class NodeStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class RunStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class NodeRun(BaseModel):
    model_config = _CAMEL_CONFIG

    kind: Literal["session", "subagent"]
    session_id: str | None = None        # kind == "session"
    orchestrator_sid: str | None = None  # kind == "subagent": parent session
    tool_use_id: str | None = None       # kind == "subagent": Task tool_use id
    agent_id: str | None = None          # kind == "subagent": SDK subagent transcript id
    status: RunStatus = RunStatus.RUNNING
    summary: str | None = None
    usage: dict | None = None            # {tokens, cost}


class WorkNode(BaseModel):
    model_config = _CAMEL_CONFIG

    id: str
    title: str
    skill: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    status: NodeStatus = NodeStatus.PENDING
    runs: list[NodeRun] = Field(default_factory=list)
    summary: str | None = None
    artifact_kind: str | None = None
    executes_plan: bool = False
    children: list["WorkNode"] | None = None
    # Completion timestamp (ISO) of the latest successful run — used for staleness.
    completed_at: str | None = None


WorkNode.model_rebuild()


class DagError(ValueError):
    """Raised when a stage/step DAG mutation would produce an invalid graph."""


def _by_id(nodes: list[WorkNode]) -> dict[str, WorkNode]:
    return {n.id: n for n in nodes}


def ready_node_ids(nodes: list[WorkNode]) -> list[str]:
    """Pending nodes whose every dependency is done (linear fallback if no deps)."""
    by_id = _by_id(nodes)
    out: list[str] = []
    ordered = list(nodes)
    for i, n in enumerate(ordered):
        if n.status != NodeStatus.PENDING:
            continue
        deps = n.depends_on or [m.id for m in ordered[:i]]
        if all(by_id.get(d) is not None and by_id[d].status == NodeStatus.DONE for d in deps):
            out.append(n.id)
    return out


def validate_dag(nodes: list[WorkNode]) -> None:
    """Raise DagError unless the graph is acyclic, complete, and orphan-free."""
    by_id = _by_id(nodes)
    if len(by_id) != len(nodes):
        raise DagError("duplicate node ids")
    for n in nodes:
        for d in n.depends_on:
            if d not in by_id:
                raise DagError(f"node {n.id!r} depends on missing {d!r}")
    # Cycle check via DFS colouring.
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {n.id: WHITE for n in nodes}

    def visit(nid: str) -> None:
        colour[nid] = GREY
        for d in by_id[nid].depends_on:
            if colour[d] == GREY:
                raise DagError(f"cycle through {d!r}")
            if colour[d] == WHITE:
                visit(d)
        colour[nid] = BLACK

    for n in nodes:
        if colour[n.id] == WHITE:
            visit(n.id)


Lifecycle = Literal["created", "design", "implementation", "done"]


def derive_lifecycle(stages: list[WorkNode]) -> Lifecycle:
    """Coarse 4-value lifecycle for the board, pivoting on the implementing node."""
    if not stages:
        return "created"
    impl = next((n for n in stages if n.executes_plan), None)
    terminal = stages[-1]
    if terminal.status == NodeStatus.DONE or (
        impl is not None and impl.status == NodeStatus.DONE
        and all(n.status in (NodeStatus.DONE, NodeStatus.FAILED) for n in stages)
    ):
        return "done"
    if impl is not None and impl.status in (NodeStatus.RUNNING, NodeStatus.DONE):
        return "implementation"
    if any(n.status in (NodeStatus.RUNNING, NodeStatus.DONE) for n in stages):
        return "design"
    return "created"
