"""ProposeChange — interactive spec amendment with 4-button approval.

Suspends the agent via a Future registered on ``Tracker``. Frontend renders
an inline card; user picks Accept / Edit / Discuss / Reject; backend resolves
the Future and the handler applies the change (or returns the deny payload
to the agent).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

from pathlib import Path

from claude_agent_sdk import create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.runtime.permissions import ToolPermissionResponse
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.board.artifact_paths import ARTIFACT_FILENAMES
from app.board.models import ArtifactKind
from app.board.patch import (
    AmendmentError,
    apply_amendment,
    append_amendment,
    build_change_diff,
    extract_spec_id_for_link,
    validate_amended_file,
)
from app.board.service import BoardService, TicketNotFoundError
from app.core.config import AppConfig, MCP_PREFIX, PROJECT_DIRNAME, TICKETS_DIR

logger = logging.getLogger(__name__)


PROPOSE_CHANGE_SCHEMA: dict = {
    "type": "object",
    "required": ["file_path", "old_string", "new_string"],
    "properties": {
        "file_path": {
            "type": "string",
            "description": (
                "Project-relative path of the spec file to amend. Must be "
                "inside the project root. Usually under .tr/design_docs/."
            ),
        },
        "old_string": {
            "type": "string",
            "description": (
                "The exact text to be replaced. Must appear once in the "
                "file. Include enough surrounding context to make it unique."
            ),
        },
        "new_string": {
            "type": "string",
            "description": "The replacement text.",
        },
        "section": {
            "type": "string",
            "description": (
                "Optional human-readable label for the card (e.g. "
                "'Components')."
            ),
        },
        "rationale": {
            "type": "string",
            "description": (
                "One-sentence justification shown above the diff and "
                "recorded in the .patch log."
            ),
        },
    },
}


def _json_result(payload: dict) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(payload)}]}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": f"Error: {text}"}], "isError": True}


# Inverse of ARTIFACT_FILENAMES — filename → ArtifactKind. Used to route
# amendments to per-ticket artifact files through BoardService so the
# ticket's *_path / *_stale / updated bookkeeping stays in sync.
_FILENAME_TO_KIND: dict[str, ArtifactKind] = {
    filename: kind for kind, filename in ARTIFACT_FILENAMES.items()
}


def _resolve_ticket_artifact(
    project_root: Path, file_path: str,
) -> tuple[str, ArtifactKind] | None:
    """Return (ticket_id, kind) when ``file_path`` is a per-ticket artifact.

    Matches paths shaped ``<meta-dir>/tickets/<id>/<known-artifact-filename>``.
    """
    try:
        rel = (project_root / file_path).resolve().relative_to(project_root.resolve())
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) != 4 or parts[0] != PROJECT_DIRNAME or parts[1] != TICKETS_DIR:
        return None
    kind = _FILENAME_TO_KIND.get(parts[3])
    if kind is None:
        return None
    return parts[2], kind


def _auto_accept_edits(config: AppConfig, ticket_id: str | None) -> bool:
    """True when the ticket opts into automatic artifact edits
    (``orchestration.artifact_edits == "auto"``) — ProposeChange then applies
    the change directly instead of suspending for the inline diff card."""
    if not ticket_id:
        return False
    try:
        cfg = BoardService(config).get_ticket(ticket_id).orchestration
        return getattr(cfg, "artifact_edits", "ask") == "auto"
    except Exception:
        return False


@tool(
    "ProposeChange",
    "Propose an amendment to a spec file. The user sees an inline diff "
    "card with four buttons (Accept / Edit / Discuss / Reject). On accept "
    "the change is applied immediately and appended to the ticket's "
    "history.patch log. Use ONLY this tool for spec amendments during "
    "the amend-specs step — never use Write or Edit on .tr/design_docs/.",
    PROPOSE_CHANGE_SCHEMA,
)
async def _propose_change(args: dict) -> dict:
    ctx = get_tool_context()
    file_path = args.get("file_path", "")
    old_string = args.get("old_string", "")
    new_string = args.get("new_string", "")
    section = args.get("section")
    rationale = args.get("rationale")
    project_root = ctx.config.get_project_root()
    ticket_id = ctx.task.ticket_id

    if not file_path or not old_string:
        return _error("file_path and old_string are required")

    # Pre-flight: verify old_string is unique without writing.
    try:
        abs_path = (project_root / file_path).resolve()
        abs_path.relative_to(project_root.resolve())
    except ValueError:
        return _error(f"file_path '{file_path}' is outside project root")
    if not abs_path.is_file():
        return _error(f"file '{file_path}' does not exist")
    content_before = abs_path.read_text(encoding="utf-8")
    n = content_before.count(old_string)
    if n == 0:
        return _error(f"old_string not found in '{file_path}'")
    if n > 1:
        return _error(
            f"old_string not unique in '{file_path}' ({n} occurrences) "
            "— include more surrounding context"
        )

    # When the ticket opts into automatic artifact edits, apply directly.
    # Otherwise suspend the agent and let the user Accept / Edit / Discuss /
    # Reject via the inline diff card.
    if _auto_accept_edits(ctx.config, ticket_id):
        response: dict = {"behavior": "allow", "applied": "original"}
    else:
        request_id = str(uuid4())
        future = ctx.tracker.register_future(ctx.task.thinkrail_sid, request_id)
        payload: dict = {
            "thinkrailSid": ctx.task.thinkrail_sid,
            "filePath": file_path,
            "oldString": old_string,
            "newString": new_string,
        }
        if section:
            payload["section"] = section
        if rationale:
            payload["rationale"] = rationale
        await ctx.notify("agent/proposeChange", payload, request_id=request_id)
        response = await future

    behavior = response.get("behavior", "deny")
    if behavior == "deny":
        return _json_result({
            "behavior": "deny",
            "discuss": bool(response.get("discuss", False)),
            "feedback": response.get("feedback"),
            "reason": response.get("reason"),
        })

    # allow path
    applied = response.get("applied", "original")
    effective_new = (
        response.get("edited_new_string", new_string)
        if applied == "edited" else new_string
    )

    artifact = _resolve_ticket_artifact(project_root, file_path)
    try:
        if artifact is not None:
            # Per-ticket artifacts must round-trip through BoardService so
            # the ticket's *_path / *_stale / updated bookkeeping refreshes.
            new_content = content_before.replace(old_string, effective_new, 1)
            BoardService(ctx.config).write_artifact(
                artifact[0], artifact[1], new_content,
            )
        else:
            new_content = apply_amendment(
                project_root=project_root,
                file_path=file_path,
                old_string=old_string,
                new_string=effective_new,
            )
    except AmendmentError as exc:
        return _error(str(exc))

    warnings = validate_amended_file(project_root, file_path)
    validation = "ok" if not warnings else "warnings"

    spec_id = extract_spec_id_for_link(project_root, file_path)

    if ticket_id:
        append_amendment(
            project_root=project_root,
            ticket_id=ticket_id,
            file_path=file_path,
            diff=build_change_diff(file_path, [(content_before, new_content)]),
            spec_id=spec_id,
            section=section,
            rationale=rationale,
            applied_as=applied,
            validation=validation,
            skill=ctx.task.skill_id,
        )
        if spec_id:
            try:
                BoardService(ctx.config).link_spec(ticket_id, spec_id)
            except TicketNotFoundError:
                logger.debug("ticket %s vanished before auto-link", ticket_id)

    # Track in the per-session artifact list (helper no-ops if not
    # ticket-linked).
    from app.agent.artifacts import persist_artifact_state, record_artifact

    artifact = record_artifact(
        ctx.task, file_path, "propose-change", project_root,
    )
    if artifact is not None:
        persist_artifact_state(project_root, ctx.task)
        await ctx.notify(
            "ui/artifactAdded",
            {
                "thinkrailSid": ctx.task.thinkrail_sid,
                "artifact": artifact.model_dump(by_alias=True),
            },
        )

    return _json_result({
        "applied": applied,
        "validation": validation,
        "warnings": warnings,
    })


propose_change_mcp_server = create_sdk_mcp_server(
    name=f"{MCP_PREFIX}amend",
    tools=[_propose_change],
)


async def intercept_propose_change(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Auto-approve — interactive flow is handled inside the tool handler."""
    return ToolPermissionResponse(behavior="allow")
