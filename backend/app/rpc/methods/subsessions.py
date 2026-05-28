"""RPC handlers for subsession/* methods."""
from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.agent.models import SubsessionType
from app.agent.service import AgentService
from app.rpc.bus import bus
from app.rpc.context import get_current_conn

_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


def _handle_errors(func):  # type: ignore[type-arg]
    async def wrapper(service: AgentService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except ValueError as exc:
            raise JsonRpcError(_INTERNAL_ERROR, str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


@_handle_errors
async def create_subsession(service: AgentService, **params: Any) -> dict:
    """Create a subsession linked to a parent session."""
    task = await service.create_subsession(
        parent_bonsai_sid=params["parentBonsaiSid"],
        subsession_type=SubsessionType(params["type"]),
        context=params.get("context"),
        name=params.get("name", ""),
    )
    conn = get_current_conn()
    if conn:
        task.created_by = conn.display_name
        await bus.publish_to_project(conn.project_path, "session/didCreate", {
            "bonsaiSid": task.bonsai_sid,
            "name": task.name or task.bonsai_sid[:8],
            "skillId": task.skill_id,
            "specIds": list(task.spec_ids),
            "filePaths": list(task.file_paths),
            "status": task.status,
            "config": task.config.model_dump(by_alias=True),
            "metaTicketId": task.meta_ticket_id,
            "createdAt": task.created,
            "createdBy": conn.display_name,
        })
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def request_summary(service: AgentService, **params: Any) -> dict:
    """Ask subsession agent to propose a return summary."""
    service.request_summary(params["bonsaiSid"])
    return {"ok": True}


@_handle_errors
async def approve_summary(service: AgentService, **params: Any) -> dict:
    """Approve a return summary."""
    bonsai_sid = params["bonsaiSid"]
    text = params["text"]
    service.approve_summary(bonsai_sid, text)

    # Notify parent session
    task = service._tracker.get_task(bonsai_sid)
    if task.parent_bonsai_sid:
        from app.rpc.bus import bus
        await bus.publish_to_session(
            task.parent_bonsai_sid,
            "subsession/returned",
            {
                "parentBonsaiSid": task.parent_bonsai_sid,
                "childBonsaiSid": bonsai_sid,
                "childName": task.name,
                "type": task.subsession_type.value if task.subsession_type else "discussion",
                "summary": text,
            },
        )
    return {"ok": True}


@_handle_errors
async def dismiss_summary(service: AgentService, **params: Any) -> dict:
    """Dismiss the return flow without returning anything."""
    service.dismiss_summary(params["bonsaiSid"])
    return {"ok": True}


@_handle_errors
async def revise_summary(service: AgentService, **params: Any) -> dict:
    """Ask agent to rewrite summary with feedback."""
    service.revise_summary(params["bonsaiSid"], params["feedback"])
    return {"ok": True}


@_handle_errors
async def list_children(service: AgentService, **params: Any) -> dict:
    """List direct child subsessions of a parent."""
    from app.agent.persistence import list_children as _list_children

    children = _list_children(
        service._config.project_root,
        params["parentBonsaiSid"],
    )
    return {"children": children}
