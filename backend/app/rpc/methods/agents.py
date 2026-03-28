from __future__ import annotations

from typing import Any

from jsonrpcserver import JsonRpcError, Result, Success

import app.rpc.notifications as notifications
from app.agent.models import AgentConfig
from app.agent.service import AgentService
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError

# Error codes per RPC spec
_TASK_NOT_FOUND = -32011
_FUTURE_NOT_FOUND = -32012
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603


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


@_handle_errors
async def get_agent_status(service: AgentService, **params: Any) -> dict:
    return service.get_task(params["bonsaiSid"]).model_dump(by_alias=True)


@_handle_errors
async def list_agents(service: AgentService, **params: Any) -> list[dict]:
    return [t.model_dump(by_alias=True) for t in service.list_tasks()]


@_handle_errors
async def run_agent(service: AgentService, **params: Any) -> dict:
    notify = notifications.current_notify
    if notify is None:
        raise JsonRpcError(_INTERNAL_ERROR, "Internal error", "No active connection")
    config = AgentConfig(**params["config"])
    skill_id = params.get("skillId")
    session_prompt = params.get("prompt")
    name = params.get("name", "")
    meta_ticket_id = params.get("metaTicketId")
    task = await service.run_task(
        params["specIds"], config, notify,
        skill_id=skill_id, session_prompt=session_prompt, name=name,
        meta_ticket_id=meta_ticket_id,
    )
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def send_message(service: AgentService, **params: Any) -> None:
    is_markdown = params.get("isMarkdown", False)
    await service.send_message(params["bonsaiSid"], params["text"], is_markdown=is_markdown)


@_handle_errors
async def end_session(service: AgentService, **params: Any) -> None:
    await service.end_session(params["bonsaiSid"])


@_handle_errors
async def interrupt_agent(service: AgentService, **params: Any) -> None:
    await service.interrupt_task(params["bonsaiSid"])


@_handle_errors
async def respond_agent(service: AgentService, **params: Any) -> None:
    await service.respond(params["bonsaiSid"], params["requestId"], params["response"])


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
    )
    return {"bonsaiSid": task.bonsai_sid, "systemPrompt": task.system_prompt}


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
    system_prompt = service.update_draft(bonsai_sid, **kwargs)
    return {"systemPrompt": system_prompt}


@_handle_errors
async def start_draft(service: AgentService, **params: Any) -> dict:
    """Start a draft session — transitions to initializing and launches the runner."""
    notify = notifications.current_notify
    if notify is None:
        raise JsonRpcError(_INTERNAL_ERROR, "Internal error", "No active connection")
    task = await service.start_draft(
        params["bonsaiSid"], notify,
        prompt=params.get("prompt"),
    )
    return {"bonsaiSid": task.bonsai_sid}


@_handle_errors
async def update_config(service: AgentService, **params: Any) -> dict:
    bonsai_sid = params["bonsaiSid"]
    model = params.get("model")
    permission_mode = params.get("permissionMode")
    betas = params.get("betas")
    effort = params.get("effort")
    result = await service.update_config(bonsai_sid, model=model, permission_mode=permission_mode, betas=betas, effort=effort)
    notify = notifications.current_notify
    if notify:
        await notify("agent/configChanged", {"bonsaiSid": bonsai_sid, **result})
    return result
