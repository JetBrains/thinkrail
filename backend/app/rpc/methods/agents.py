from __future__ import annotations

import uuid
from typing import Any

from jsonrpcserver import JsonRpcError

from app.rpc.bus import bus
from app.rpc.context import auto_subscribe_all, get_current_conn
from app.rpc.errors import (
    FUTURE_NOT_FOUND,
    INTERNAL_ERROR,
    INVALID_CAPABILITY_VALUE,
    INVALID_PARAMS,
    TASK_NOT_FOUND,
    UNKNOWN_RUNTIME,
    rpc_handler,
)
from app import analytics
from app.analytics import AgentSessionStartedEvent, VoiceTranscriptRevisedEvent
from app.agent.exceptions import InvalidCapabilityValueError
from app.agent.models import AgentConfig
from app.agent.runtime import UnknownRuntimeError
from app.agent.service import AgentService
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError

_handle_errors = rpc_handler(
    (TaskNotFoundError, TASK_NOT_FOUND, "Agent task not found"),
    (FutureNotFoundError, FUTURE_NOT_FOUND, "No pending request"),
    (UnknownRuntimeError, UNKNOWN_RUNTIME, "Unknown runtime"),
    (InvalidCapabilityValueError, INVALID_CAPABILITY_VALUE, "Invalid capability value"),
)

_MAX_DRAFT_INPUT = 100_000


def _validated_sid(raw: Any) -> str | None:
    """Validate a client-supplied thinkrailSid as a UUID before it is reused as a
    session-file name. Returns None when absent so the server mints its own."""
    if raw is None:
        return None
    try:
        return str(uuid.UUID(str(raw)))
    except (ValueError, AttributeError, TypeError) as exc:
        raise JsonRpcError(INVALID_PARAMS, "Invalid thinkrailSid") from exc


def _validated_draft_input(raw: Any) -> Any:
    if isinstance(raw, str) and len(raw) > _MAX_DRAFT_INPUT:
        raise JsonRpcError(INVALID_PARAMS, "draftInput exceeds maximum length")
    return raw


@_handle_errors
async def get_agent_status(service: AgentService, **params: Any) -> dict:
    return service.get_task(params["thinkrailSid"]).model_dump(by_alias=True)


@_handle_errors
async def list_agents(service: AgentService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tasks()]


@_handle_errors
async def run_agent(service: AgentService, **params: Any) -> dict:
    config = AgentConfig(**params["config"])
    task = await service.run_task(
        params["specIds"], config,
        skill_id=params.get("skillId"),
        session_prompt=params.get("prompt"),
        name=params.get("name", ""),
        ticket_id=params.get("ticketId"),
    )
    analytics.track_event(AgentSessionStartedEvent())
    conn = get_current_conn()
    if conn:
        task.created_by = conn.display_name
        await bus.publish_to_project(conn.project_path, "session/didCreate", {
            "thinkrailSid": task.thinkrail_sid,
            "name": task.name or task.thinkrail_sid[:8],
            "skillId": task.skill_id,
            "specIds": list(task.spec_ids),
            "filePaths": list(task.file_paths),
            "status": task.status,
            "config": task.config.model_dump(by_alias=True),
            "ticketId": task.ticket_id,
            "createdAt": task.created,
            "createdBy": conn.display_name,
        })
    auto_subscribe_all(task.thinkrail_sid)
    return {"thinkrailSid": task.thinkrail_sid}


@_handle_errors
async def send_message(service: AgentService, **params: Any) -> None:
    thinkrail_sid = params["thinkrailSid"]
    text = params["text"]
    is_markdown = params.get("isMarkdown", False)
    await service.send_message(thinkrail_sid, text, is_markdown=is_markdown)
    conn = get_current_conn()
    sender = conn.display_name if conn else "Unknown"
    await bus.publish_to_session(thinkrail_sid, "session/userMessage", {
        "thinkrailSid": thinkrail_sid,
        "text": text,
        "isMarkdown": is_markdown,
        "sentBy": sender,
    })


@_handle_errors
async def retry_last_message(service: AgentService, **params: Any) -> dict:
    """Retry the last user message (e.g. after a context_overflow error)."""
    thinkrail_sid = params["thinkrailSid"]
    last_msg = service.get_last_message(thinkrail_sid)
    if not last_msg:
        raise ValueError("No message to retry")
    await service.send_message(thinkrail_sid, last_msg)
    return {"ok": True}


@_handle_errors
async def end_session(service: AgentService, **params: Any) -> None:
    await service.end_session(params["thinkrailSid"])


@_handle_errors
async def interrupt_agent(service: AgentService, **params: Any) -> None:
    await service.interrupt_task(params["thinkrailSid"])


@_handle_errors
async def respond_agent(service: AgentService, **params: Any) -> None:
    thinkrail_sid = params["thinkrailSid"]
    request_id = params["requestId"]
    response = params["response"]
    await service.respond(thinkrail_sid, request_id, response)
    conn = get_current_conn()
    resolved_by = conn.display_name if conn else "Unknown"
    await bus.publish_to_session(thinkrail_sid, "agent/requestResolved", {
        "thinkrailSid": thinkrail_sid,
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
        raise JsonRpcError(INTERNAL_ERROR, "Transcription module unavailable")
    text = await transcribe(params["audioBase64"], params["mimeType"])
    return {"text": text}


@_handle_errors
async def revise_transcript_rpc(service: AgentService, **params: Any) -> dict:
    """One-shot voice-transcript revise via ``claude_agent_sdk.query``."""
    from app.agent.revise import revise_transcript
    analytics.track_event(VoiceTranscriptRevisedEvent())
    text = await revise_transcript(params["text"], model=params.get("model"))
    return {"text": text}


@_handle_errors
async def prepare_agent(service: AgentService, **params: Any) -> dict:
    """Create a draft session without starting it. Returns thinkrailSid + systemPrompt."""
    config = AgentConfig(**params["config"])
    task = await service.prepare_task(
        params["specIds"], config,
        skill_id=params.get("skillId"),
        session_prompt=params.get("prompt"),
        name=params.get("name", ""),
        ticket_id=params.get("ticketId"),
        file_paths=params.get("filePaths"),
        thinkrail_sid=_validated_sid(params.get("thinkrailSid")),
        draft_input=_validated_draft_input(params.get("draftInput")),
    )
    auto_subscribe_all(task.thinkrail_sid)
    conn = get_current_conn()
    if conn:
        task.created_by = conn.display_name
        await bus.publish_to_project(conn.project_path, "session/didCreate", {
            "thinkrailSid": task.thinkrail_sid,
            "name": task.name or task.thinkrail_sid[:8],
            "skillId": task.skill_id,
            "specIds": list(task.spec_ids),
            "filePaths": list(task.file_paths),
            "status": task.status,
            "config": task.config.model_dump(by_alias=True),
            "ticketId": task.ticket_id,
            "createdAt": task.created,
            "createdBy": conn.display_name,
        })
    structured = await service._build_context_structured_for(task)
    return {
        "thinkrailSid": task.thinkrail_sid,
        "systemPrompt": structured["full"],
        "sections": structured["sections"],
        "totalTokens": structured["totalTokens"],
    }


@_handle_errors
async def update_draft(service: AgentService, **params: Any) -> dict:
    """Update a draft session's config and return the rebuilt system prompt."""
    thinkrail_sid = params["thinkrailSid"]
    kwargs: dict[str, Any] = {}
    if "specIds" in params:
        kwargs["spec_ids"] = params["specIds"]
    if "skillId" in params:
        kwargs["skill_id"] = params["skillId"]
    if "config" in params:
        kwargs["config"] = AgentConfig(**params["config"])
    if "prompt" in params:
        kwargs["session_prompt"] = params["prompt"]
    if "draftInput" in params:
        kwargs["draft_input"] = _validated_draft_input(params["draftInput"])
    if "name" in params:
        kwargs["name"] = params["name"]
    if "ticketId" in params:
        kwargs["ticket_id"] = params["ticketId"]
    if "filePaths" in params:
        kwargs["file_paths"] = params["filePaths"]
    if "subagentMode" in params:
        kwargs["subagent_mode"] = params["subagentMode"]
    if "stepGate" in params:
        kwargs["step_gate"] = params["stepGate"]
    structured = await service.update_draft(thinkrail_sid, **kwargs)
    return {
        "systemPrompt": structured["full"],
        "sections": structured["sections"],
        "totalTokens": structured["totalTokens"],
    }


@_handle_errors
async def start_draft(service: AgentService, **params: Any) -> dict:
    """Start a draft session — transitions to initializing and launches the runner."""
    thinkrail_sid = params["thinkrailSid"]
    auto_subscribe_all(thinkrail_sid)
    task = await service.start_draft(
        thinkrail_sid,
        prompt=params.get("prompt"),
    )
    analytics.track_event(AgentSessionStartedEvent())
    # Publish full metadata so other clients have name, config, specs
    conn = get_current_conn()
    if conn:
        task.created_by = conn.display_name
        await bus.publish_to_project(conn.project_path, "session/didCreate", {
            "thinkrailSid": task.thinkrail_sid,
            "name": task.name or task.thinkrail_sid[:8],
            "skillId": task.skill_id,
            "specIds": list(task.spec_ids),
            "filePaths": list(task.file_paths),
            "status": task.status,
            "config": task.config.model_dump(by_alias=True),
            "ticketId": task.ticket_id,
            "createdAt": task.created,
            "createdBy": conn.display_name,
        })
    return {"thinkrailSid": task.thinkrail_sid}


@_handle_errors
async def update_config(service: AgentService, **params: Any) -> dict:
    thinkrail_sid = params["thinkrailSid"]
    result = await service.update_config(
        thinkrail_sid,
        model=params.get("model"),
        permission_mode=params.get("permissionMode"),
        effort=params.get("effort"),
    )
    await bus.publish_to_session(thinkrail_sid, "agent/configChanged", {
        "thinkrailSid": thinkrail_sid,
        **result,
    })
    return result
