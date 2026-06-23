"""Orchestration MCP tools — the ticket-orchestrator mutates the stage DAG.

Structural edits funnel into ``BoardService.apply`` (validated) and emit
``ticket/didChange``. In approve mode the can_use_tool interceptor surfaces a
card before these run (see permissions.py). See design §3, §7.
"""

from __future__ import annotations

import logging

from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.models import AgentTask, SessionConfig
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig, MCP_PREFIX
from app.board.ops import find_node
from app.board.service import BoardService, TicketNotFoundError
from app.board.ticket_state import publish_ticket_state
from app.board.work_node import DagError, NodeStatus

logger = logging.getLogger(__name__)


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


async def _apply_and_emit(op: dict) -> dict:
    """Apply *op* to the current ticket's DAG and broadcast the new state."""
    ctx = get_tool_context()
    ticket_id = ctx.task.ticket_id
    if not ticket_id:
        return _error("session is not linked to a ticket")
    board = BoardService(ctx.config)
    try:
        board.apply(ticket_id, op)
    except TicketNotFoundError:
        return _error(f"ticket {ticket_id} not found")
    except DagError as exc:
        return _error(str(exc))
    await publish_ticket_state(board, str(ctx.config.project_root), ticket_id)
    return _ok(f"✓ applied {op.get('op')}")


PIPELINE_SCHEMA = {
    "type": "object", "required": ["nodes"],
    "properties": {"nodes": {"type": "array", "items": {"type": "object"}}},
}
ADD_SCHEMA = {
    "type": "object", "required": ["node"],
    "properties": {"node": {"type": "object"}},
}
ID_SCHEMA = {"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}
DEPS_SCHEMA = {
    "type": "object", "required": ["id", "dependsOn"],
    "properties": {"id": {"type": "string"},
                   "dependsOn": {"type": "array", "items": {"type": "string"}}},
}


@tool("propose_pipeline", "Propose/replace the full stage DAG for this ticket.", PIPELINE_SCHEMA)
async def _propose_pipeline(args: dict) -> dict:
    return await _apply_and_emit({"op": "proposePipeline", "nodes": args["nodes"]})


@tool("add_node", "Add one stage to the DAG.", ADD_SCHEMA)
async def _add_node(args: dict) -> dict:
    return await _apply_and_emit({"op": "addNode", "node": args["node"]})


@tool("remove_node", "Remove a pending stage from the DAG.", ID_SCHEMA)
async def _remove_node(args: dict) -> dict:
    return await _apply_and_emit({"op": "removeNode", "id": args["id"]})


@tool("set_depends_on", "Rewire a stage's dependencies.", DEPS_SCHEMA)
async def _set_depends_on(args: dict) -> dict:
    return await _apply_and_emit(
        {"op": "setDependsOn", "id": args["id"], "dependsOn": args["dependsOn"]},
    )


CHILDREN_SCHEMA = {
    "type": "object", "required": ["parentId", "nodes"],
    "properties": {"parentId": {"type": "string"},
                   "nodes": {"type": "array", "items": {"type": "object"}}},
}


@tool("propose_children",
      "Break a node (the implementing node) into its step children (a sub-DAG).",
      CHILDREN_SCHEMA)
async def _propose_children(args: dict) -> dict:
    return await _apply_and_emit(
        {"op": "proposeChildren", "parentId": args["parentId"], "nodes": args["nodes"]},
    )


@tool("start_node",
      "Launch an interactive session for a ready node (stage or step). The "
      "session runs the node's skill (or ticket-implement for the executesPlan "
      "node); it produces the node's artifact and signals done via SessionFinalize.",
      ID_SCHEMA)
async def _start_node(args: dict) -> dict:
    ctx = get_tool_context()
    ticket_id = ctx.task.ticket_id
    agent_service = getattr(ctx, "agent_service", None)
    if not ticket_id:
        return _error("session is not linked to a ticket")
    if agent_service is None:
        return _error("agent service unavailable; cannot launch a stage session")
    board = BoardService(ctx.config)
    try:
        ticket = board.get_ticket(ticket_id)
    except TicketNotFoundError:
        return _error(f"ticket {ticket_id} not found")

    node = find_node(ticket.stages, args["id"])
    if node is None:
        return _error(f"unknown node {args['id']!r}")

    # Idempotency: if the node already has a running session, return it.
    if node.status in (NodeStatus.RUNNING, NodeStatus.DONE) and node.runs:
        last_sid = node.runs[-1].session_id
        return _ok(
            f"node {node.id!r} is already {node.status}"
            + (f" (session {last_sid[:8]})" if last_sid else "")
        )

    unfinished = [
        dep_id
        for dep_id in node.depends_on
        if (dep := find_node(ticket.stages, dep_id)) is None or dep.status != NodeStatus.DONE
    ]
    if unfinished:
        return _error(
            f"node {node.id!r} not ready — unfinished dependencies: {', '.join(unfinished)}"
        )

    # Per-ticket stage gate — runs in all permission modes (including bypass/yolo).
    # Lazy import avoids the circular: permissions → tools/__init__ → orchestration.
    from app.agent.permissions import _orchestration_gate, _await_user_response  # noqa: PLC0415
    orch_cfg = ticket.orchestration.model_dump()
    gate = _orchestration_gate(ctx.task.skill_id, orch_cfg)
    if gate == "approve":
        response, _ = await _await_user_response(
            ctx.tracker, ctx.notify, ctx.task, ctx.config,
            method="agent/confirmAction",
            params={
                "thinkrailSid": ctx.task.thinkrail_sid,
                "toolName": "start_node",
                "toolInput": {"id": node.id, "title": node.title},
                "toolUseId": None,
            },
        )
        if response.get("behavior") != "allow":
            return _error(f"stage launch declined for node {node.id!r}")

    skill = "ticket-implement" if node.executes_plan else node.skill
    if skill is None:
        return _error(f"node {node.id!r} has no skill configured")
    run_task_kwargs: dict = dict(
        spec_ids=list(ticket.linked_spec_ids),
        config=ctx.task.config,
        skill_id=skill,
        ticket_id=ticket_id,
        name=node.title,
    )
    if node.executes_plan:
        run_task_kwargs["subagent_mode"] = (
            "subagent" if ticket.orchestration.step_execution == "subagent" else "step-session"
        )
    child = await agent_service.run_task(**run_task_kwargs)
    board.apply(ticket_id, {"op": "recordRunStart", "id": node.id, "run": {
        "kind": "session", "sessionId": child.thinkrail_sid, "status": "running",
    }})
    await publish_ticket_state(board, str(ctx.config.project_root), ticket_id)
    impl_hint = (
        "\n\nThis is the implementation stage: drive your step children — if you "
        "have no children yet, call propose_children(...), then launch each ready "
        "step (start_node for interactive steps, or Agent for subagent steps per "
        "the ticket's step_execution setting)."
        if node.executes_plan else ""
    )
    await agent_service.send_message(
        child.thinkrail_sid,
        f"You are running stage '{node.title}' (node {node.id}) of ticket "
        f"{ticket_id}. Read the linked specs/source, do the work, edit files "
        f"directly, and call SessionFinalize when the "
        f"deliverable is ready." + impl_hint,
    )
    return _ok(f"✓ launched session {child.thinkrail_sid[:8]} for node {node.id}")


orchestration_mcp_server = create_sdk_mcp_server(
    name=f"{MCP_PREFIX}orchestration",
    tools=[_propose_pipeline, _add_node, _remove_node, _set_depends_on,
           _propose_children, _start_node],
)


async def intercept_orchestration(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve DAG mutations. Interactive per-ticket gating is layered
    inside _start_node via permissions._gate_for_tool."""
    return ToolPermissionResponse(behavior="allow")
