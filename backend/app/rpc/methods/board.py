from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.board.plan import Milestone, Plan, PlanStep, SuccessCriterion
from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError

_TICKET_NOT_FOUND = -32021
_INVALID_TRANSITION = -32022
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _handle_errors(func):  # type: ignore[type-arg]
    """Decorator that maps domain exceptions to JSON-RPC errors."""

    async def wrapper(service: BoardService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except TicketNotFoundError as exc:
            raise JsonRpcError(_TICKET_NOT_FOUND, "Ticket not found", str(exc))
        except InvalidTransitionError as exc:
            raise JsonRpcError(_INVALID_TRANSITION, "Invalid transition", str(exc))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except ValueError as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Validation error", str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


@_handle_errors
async def list_tickets(service: BoardService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tickets()]


@_handle_errors
async def get_ticket(service: BoardService, **params: Any) -> dict:
    return service.get_ticket(params["id"]).model_dump(by_alias=True)


@_handle_errors
async def create_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.create_ticket(
        title=params["title"],
        body=params.get("body", ""),
        type=params.get("type", "feature"),
    )
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def update_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.update_ticket(
        id=params["id"],
        title=params.get("title"),
        body=params.get("body"),
        status=params.get("status"),
        type=params.get("type"),
    )
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def delete_ticket(service: BoardService, **params: Any) -> None:
    service.delete_ticket(params["id"])


@_handle_errors
async def reorder_ticket(service: BoardService, **params: Any) -> dict:
    ticket = service.reorder_ticket(params["id"], params["status"], params["order"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def link_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.link_spec(params["ticketId"], params["specId"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def unlink_spec(service: BoardService, **params: Any) -> dict:
    ticket = service.unlink_spec(params["ticketId"], params["specId"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def attach_session(service: BoardService, **params: Any) -> dict:
    ticket = service.attach_session(params["ticketId"], params["sessionId"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def set_plan_path(service: BoardService, **params: Any) -> dict:
    ticket = service.set_plan_path(params["ticketId"], params["planPath"])
    return ticket.model_dump(by_alias=True)


@_handle_errors
async def set_orchestrator(service: BoardService, **params: Any) -> dict:
    ticket = service.set_orchestrator(params["ticketId"], params["sessionId"])
    return ticket.model_dump(by_alias=True)


# -- Plan methods -------------------------------------------------------------


@_handle_errors
async def get_plan(service: BoardService, **params: Any) -> dict | None:
    ticket_id = params["ticketId"]
    if not service.plans.plan_exists(ticket_id):
        return None
    return service.plans.read_plan(ticket_id).model_dump(by_alias=True)


@_handle_errors
async def create_plan(service: BoardService, **params: Any) -> dict:
    ticket_id = params["ticketId"]
    title = params["title"]
    raw_steps = params.get("steps", [])
    raw_verification = params.get("verification", [])

    steps = [PlanStep(**s) for s in raw_steps]
    verification = [SuccessCriterion(**c) for c in raw_verification]

    plan = service.plans.create_plan(ticket_id, title, steps, verification)
    # Auto-set planPath on the ticket
    plan_path = f"plans/{ticket_id}.md"
    service.set_plan_path(ticket_id, plan_path)
    return plan.model_dump(by_alias=True)


@_handle_errors
async def update_step(service: BoardService, **params: Any) -> dict:
    plan = service.plans.update_step_status(
        ticket_id=params["ticketId"],
        step_number=params["stepNumber"],
        status=params["status"],
        session_id=params.get("sessionId"),
    )
    return plan.model_dump(by_alias=True)


@_handle_errors
async def save_plan(service: BoardService, **params: Any) -> dict:
    """Save a full structured plan (milestones + verification)."""
    ticket_id = params["ticketId"]
    raw_plan = params["plan"]
    milestones = [
        Milestone(
            number=m["number"],
            title=m["title"],
            description=m.get("description", ""),
            steps=[PlanStep(**s) for s in m.get("steps", [])],
        )
        for m in raw_plan.get("milestones", [])
    ]
    verification = [SuccessCriterion(**c) for c in raw_plan.get("verification", [])]
    plan = Plan(
        ticket_id=ticket_id,
        title=raw_plan.get("title", ""),
        status=raw_plan.get("status", "draft"),
        milestones=milestones,
        verification=verification,
    )
    result = service.plans.save_plan(ticket_id, plan)
    # Ensure planPath is set on the ticket
    ticket = service.get_ticket(ticket_id)
    if not ticket.plan_path:
        service.set_plan_path(ticket_id, f"plans/{ticket_id}.md")
    return result.model_dump(by_alias=True)


@_handle_errors
async def get_plan_raw(service: BoardService, **params: Any) -> dict:
    """Return the raw markdown content of a plan file."""
    ticket_id = params["ticketId"]
    if not service.plans.plan_exists(ticket_id):
        return {"content": ""}
    content = service.plans.read_plan_raw(ticket_id)
    return {"content": content}


@_handle_errors
async def save_plan_raw(service: BoardService, **params: Any) -> dict:
    """Write raw markdown and return the parsed plan."""
    ticket_id = params["ticketId"]
    content = params["content"]
    plan = service.plans.write_plan_raw(ticket_id, content)
    # Ensure planPath is set on the ticket
    ticket = service.get_ticket(ticket_id)
    if not ticket.plan_path:
        service.set_plan_path(ticket_id, f"plans/{ticket_id}.md")
    return plan.model_dump(by_alias=True)


@_handle_errors
async def get_next_step(service: BoardService, **params: Any) -> dict | None:
    step = service.plans.get_next_step(params["ticketId"])
    if step is None:
        return None
    return step.model_dump(by_alias=True)


# -- Spec draft methods -------------------------------------------------------


@_handle_errors
async def list_drafts(service: BoardService, **params: Any) -> list[dict]:
    entries = service.spec_drafts.list_drafts(params["ticketId"])
    return [e.model_dump(by_alias=True) for e in entries]


@_handle_errors
async def get_draft_diff(service: BoardService, **params: Any) -> dict:
    return service.spec_drafts.get_draft_diff(params["ticketId"], params["index"])


@_handle_errors
async def apply_draft(service: BoardService, **params: Any) -> None:
    service.spec_drafts.apply_draft(
        params["ticketId"], params["index"], board_service=service,
    )


@_handle_errors
async def apply_all_drafts(service: BoardService, **params: Any) -> None:
    service.spec_drafts.apply_all(params["ticketId"], board_service=service)


@_handle_errors
async def discard_draft(service: BoardService, **params: Any) -> None:
    service.spec_drafts.discard_draft(params["ticketId"], params["index"])


@_handle_errors
async def discard_all_drafts(service: BoardService, **params: Any) -> None:
    service.spec_drafts.discard_all(params["ticketId"])


# -- Spec patch methods -------------------------------------------------------


@_handle_errors
async def list_patches(service: BoardService, **params: Any) -> list[dict]:
    ticket = service.get_ticket(params["ticketId"])
    return [p.model_dump(by_alias=True) for p in ticket.spec_patches]


@_handle_errors
async def get_patch_diff(service: BoardService, **params: Any) -> dict:
    """Read a .patch file and reconstruct original/modified pair for DiffEditor."""
    ticket = service.get_ticket(params["ticketId"])
    index = params["index"]
    if index < 0 or index >= len(ticket.spec_patches):
        raise IndexError(f"Patch index {index} out of range")

    patch_record = ticket.spec_patches[index]
    patch_path = service._config.get_project_root() / ".bonsai" / patch_record.patch_path

    if not patch_path.is_file():
        return {
            "original": "",
            "modified": "",
            "path": patch_record.spec_path,
            "operation": patch_record.operation,
        }

    from app.core.fileio import read_text
    patch_content = read_text(patch_path)

    # Reconstruct original and modified from unified diff
    original_lines: list[str] = []
    modified_lines: list[str] = []
    for line in patch_content.splitlines(keepends=True):
        if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
            continue
        if line.startswith("-"):
            original_lines.append(line[1:])
        elif line.startswith("+"):
            modified_lines.append(line[1:])
        elif line.startswith(" "):
            original_lines.append(line[1:])
            modified_lines.append(line[1:])

    return {
        "original": "".join(original_lines),
        "modified": "".join(modified_lines),
        "path": patch_record.spec_path,
        "operation": patch_record.operation,
    }


@_handle_errors
async def revert_patch(service: BoardService, **params: Any) -> dict:
    """Revert a previously applied patch by applying it in reverse."""
    ticket = service.get_ticket(params["ticketId"])
    index = params["index"]
    if index < 0 or index >= len(ticket.spec_patches):
        raise IndexError(f"Patch index {index} out of range")

    patch_record = ticket.spec_patches[index]
    spec_path = service._config.get_project_root() / patch_record.spec_path

    from app.core.fileio import read_text as _read, write_text as _write, ensure_dir
    current_content = _read(spec_path) if spec_path.is_file() else ""

    # Read the original from the patch
    patch_path = service._config.get_project_root() / ".bonsai" / patch_record.patch_path
    if not patch_path.is_file():
        raise FileNotFoundError(f"Patch file not found: {patch_record.patch_path}")

    patch_content = _read(patch_path)
    original_lines: list[str] = []
    for line in patch_content.splitlines(keepends=True):
        if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
            continue
        if line.startswith("-"):
            original_lines.append(line[1:])
        elif line.startswith("+"):
            pass
        elif line.startswith(" "):
            original_lines.append(line[1:])

    original_content = "".join(original_lines)

    # Write the original content back
    if patch_record.operation == "created":
        from app.spec.service import SpecService
        try:
            svc = SpecService(service._config)
            svc.trash_service = service.trash_service
            svc.delete_spec(patch_record.spec_id)
        except Exception:
            pass
    else:
        _write(spec_path, original_content)
        from app.spec.service import SpecService
        try:
            SpecService(service._config).update_spec(patch_record.spec_id, original_content)
        except Exception:
            pass

    # Record a reverse patch
    import difflib
    from app.board.models import SpecPatch
    from datetime import UTC, datetime

    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    rev_filename = f"{patch_record.spec_id}-revert-{timestamp}.patch"
    rev_rel = f"spec-patches/{params['ticketId']}/{rev_filename}"
    rev_diff = difflib.unified_diff(
        current_content.splitlines(keepends=True),
        original_content.splitlines(keepends=True),
        fromfile=f"a/{patch_record.spec_path}",
        tofile=f"b/{patch_record.spec_path}",
    )
    rev_path = service._config.get_project_root() / ".bonsai" / rev_rel
    ensure_dir(rev_path.parent)
    _write(rev_path, "".join(rev_diff))

    rev_record = SpecPatch(
        spec_id=patch_record.spec_id,
        spec_title=f"Revert: {patch_record.spec_title}",
        operation="modified" if patch_record.operation != "created" else "deleted",
        patch_path=rev_rel,
        spec_path=patch_record.spec_path,
        session_id="revert",
    )
    updated = service.add_spec_patch(params["ticketId"], rev_record)
    return updated.model_dump(by_alias=True)
