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
    return service.get_task(params["taskId"]).model_dump()


@_handle_errors
async def list_agents(service: AgentService, **params: Any) -> list[dict]:
    return [t.model_dump() for t in service.list_tasks()]


@_handle_errors
async def run_agent(service: AgentService, **params: Any) -> dict:
    notify = notifications.current_notify
    if notify is None:
        raise JsonRpcError(_INTERNAL_ERROR, "Internal error", "No active connection")
    config = AgentConfig(**params["config"])
    task = await service.run_task(params["specIds"], config, notify)
    return {"taskId": task.id}


@_handle_errors
async def interrupt_agent(service: AgentService, **params: Any) -> None:
    await service.interrupt_task(params["taskId"])


@_handle_errors
async def respond_agent(service: AgentService, **params: Any) -> None:
    await service.respond(params["taskId"], params["requestId"], params["response"])
