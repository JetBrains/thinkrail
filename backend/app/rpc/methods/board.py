from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.board.plan import PlanStep, SuccessCriterion
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
async def get_next_step(service: BoardService, **params: Any) -> dict | None:
    step = service.plans.get_next_step(params["ticketId"])
    if step is None:
        return None
    return step.model_dump(by_alias=True)
