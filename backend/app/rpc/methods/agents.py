from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

from app.rpc.bus import bus
from app.rpc.connections import current_conn_id
from app.agent.models import AgentConfig
from app.agent.service import AgentService
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError

# Error codes per RPC spec
_TASK_NOT_FOUND = -32011
_FUTURE_NOT_FOUND = -32012
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603
_ALREADY_RESOLVED = -32013


def _handle_errors(func):  # type: ignore[type-arg]
    """Decorator that maps agent domain exceptions to JSON-RPC errors."""

    async def wrapper(service: AgentService, **params: Any) -> Result:
        try:
            return Success(await func(service, **params))
        except TaskNotFoundError as exc:
            raise JsonRpcError(_TASK_NOT_FOUND, "Agent task not found", str(exc))
        except FutureNotFoundError as exc:
            raise JsonRpcError(_FUTURE_NOT_FOUND, "No pending request", str(exc))
        except (KeyError, TypeError) as exc:
            raise JsonRpcError(_INVALID_PARAMS, "Invalid params", str(exc))
        except JsonRpcError:
            raise
        except Exception as exc:
            raise JsonRpcError(_INTERNAL_ERROR, "Internal error", str(exc))

    wrapper.__name__ = func.__name__
    wrapper.__qualname__ = func.__qualname__
    return wrapper


def _auto_subscribe_all(bonsai_sid: str) -> None:
    """Subscribe ALL connections on the same project to a session topic.

    Phase 1: every client sees every session's events.
    Phase 3 will restrict to explicit per-client subscriptions.
    """
    try:
        conn_id = current_conn_id.get()
        conn = bus.get_connection(conn_id)
        if conn:
            topic = f"session:{bonsai_sid}"
            for c in bus.connections_for_project(conn.project_path):
                bus.subscribe(c.conn_id, topic)
    except LookupError:
        pass  # No connection context (e.g. internal call)


@_handle_errors
async def get_agent_status(service: AgentService, **params: Any) -> dict:
    return service.get_task(params["bonsaiSid"]).model_dump(by_alias=True)


@_handle_errors
async def list_agents(service: AgentService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tasks()]


@_handle_errors
async def run_agent(service: AgentService, **params: Any) -> dict:
    config = AgentConfig(**params["config"])
    skill_id = params.get("skillId")
    session_prompt = params.get("prompt")
    name = params.get("name", "")
    meta_ticket_id = params.get("metaTicketId")
    task = await service.run_task(
        params["specIds"], config,
        skill_id=skill_id, session_prompt=session_prompt, name=name,
        meta_ticket_id=meta_ticket_id,
    )
    _auto_subscribe_all(task.bonsai_sid)
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def send_message(service: AgentService, **params: Any) -> None:
    bonsai_sid = params["bonsaiSid"]
    text = params["text"]
    is_markdown = params.get("isMarkdown", False)
    await service.send_message(bonsai_sid, text, is_markdown=is_markdown)
    # Notify other clients about the user message so their chat streams update
    await bus.publish_to_session(bonsai_sid, "session/userMessage", {
        "bonsaiSid": bonsai_sid,
        "text": text,
        "isMarkdown": is_markdown,
    })


@_handle_errors
async def end_session(service: AgentService, **params: Any) -> None:
    await service.end_session(params["bonsaiSid"])


@_handle_errors
async def interrupt_agent(service: AgentService, **params: Any) -> None:
    await service.interrupt_task(params["bonsaiSid"])


@_handle_errors
async def respond_agent(service: AgentService, **params: Any) -> None:
    bonsai_sid = params["bonsaiSid"]
    request_id = params["requestId"]
    response = params["response"]
    await service.respond(bonsai_sid, request_id, response)
    # Notify other subscribers that this request was resolved
    try:
        conn_id = current_conn_id.get()
        conn = bus.get_connection(conn_id)
        resolved_by = conn.display_name if conn else "Unknown"
    except LookupError:
        resolved_by = "Unknown"
    await bus.publish_to_session(bonsai_sid, "agent/requestResolved", {
        "bonsaiSid": bonsai_sid,
        "requestId": request_id,
        "resolvedBy": resolved_by,
        "response": response,
    })


@_handle_errors
async def transcribe_audio(service: AgentService, **params: Any) -> dict:
    """Transcribe audio via OpenAI Whisper API (fallback for browsers without Web Speech API)."""
    try:
        from app.agent.transcribe import transcribe
    except ImportError:
        raise JsonRpcError(_INTERNAL_ERROR, "Transcription module unavailable")
    text = await transcribe(params["audioBase64"], params["mimeType"])
    return {"text": text}


@_handle_errors
async def prepare_agent(service: AgentService, **params: Any) -> dict:
    """Create a draft session without starting it. Returns bonsaiSid + systemPrompt."""
    config = AgentConfig(**params["config"])
    task = service.prepare_task(
        params["specIds"], config,
        skill_id=params.get("skillId"),
        session_prompt=params.get("prompt"),
        name=params.get("name", ""),
        meta_ticket_id=params.get("metaTicketId"),
        file_paths=params.get("filePaths"),
    )
    _auto_subscribe_all(task.bonsai_sid)
    # Notify all project clients about the new session (multi-client sync)
    try:
        conn_id = current_conn_id.get()
        conn = bus.get_connection(conn_id)
        if conn:
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
            })
    except LookupError:
        pass
    structured = service._build_context_structured_for(task)
    return {
        "bonsaiSid": task.bonsai_sid,
        "systemPrompt": structured["full"],
        "sections": structured["sections"],
        "totalTokens": structured["totalTokens"],
    }


@_handle_errors
async def update_draft(service: AgentService, **params: Any) -> dict:
    """Update a draft session's config and return the rebuilt system prompt."""
    bonsai_sid = params["bonsaiSid"]
    kwargs: dict[str, Any] = {}
    if "specIds" in params:
        kwargs["spec_ids"] = params["specIds"]
    if "skillId" in params:
        kwargs["skill_id"] = params["skillId"]
    if "config" in params:
        kwargs["config"] = AgentConfig(**params["config"])
    if "prompt" in params:
        kwargs["session_prompt"] = params["prompt"]
    if "name" in params:
        kwargs["name"] = params["name"]
    if "metaTicketId" in params:
        kwargs["meta_ticket_id"] = params["metaTicketId"]
    if "filePaths" in params:
        kwargs["file_paths"] = params["filePaths"]
    structured = service.update_draft(bonsai_sid, **kwargs)
    return {
        "systemPrompt": structured["full"],
        "sections": structured["sections"],
        "totalTokens": structured["totalTokens"],
    }


@_handle_errors
async def start_draft(service: AgentService, **params: Any) -> dict:
    """Start a draft session — transitions to initializing and launches the runner."""
    bonsai_sid = params["bonsaiSid"]
    _auto_subscribe_all(bonsai_sid)
    task = await service.start_draft(
        bonsai_sid,
        prompt=params.get("prompt"),
    )
    # Publish full metadata so other clients have name, config, specs
    try:
        conn_id = current_conn_id.get()
        conn = bus.get_connection(conn_id)
        if conn:
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
            })
    except LookupError:
        pass
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def update_config(service: AgentService, **params: Any) -> dict:
    bonsai_sid = params["bonsaiSid"]
    model = params.get("model")
    permission_mode = params.get("permissionMode")
    betas = params.get("betas")
    effort = params.get("effort")
    result = await service.update_config(bonsai_sid, model=model, permission_mode=permission_mode, betas=betas, effort=effort)
    await bus.publish_to_session(bonsai_sid, "agent/configChanged", {"bonsaiSid": bonsai_sid, **result})
    return result
