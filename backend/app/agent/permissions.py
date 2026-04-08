"""Tool permission routing for the agent runtime."""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny, ToolPermissionContext

from app.agent.models import AgentTask
from app.agent.tools import INTERCEPTORS
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.core.settings import load_settings

logger = logging.getLogger(__name__)


async def _await_user_response(
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
    method: str,
    params: dict[str, Any],
) -> tuple[dict | None, str]:
    """Block until the user responds or the timeout policy resolves.

    Implements configurable timeout behavior (interrupt / deny / retry)
    with the same ``request_id`` reused across retry attempts so the
    frontend sees a single pending request, not duplicates.

    Returns ``(response_dict, request_id)``.  *response_dict* is ``None``
    when the final timeout fires (caller should deny).
    """
    settings = load_settings(config.project_root)
    timeout = settings.user_respond_timeout  # 0 = infinite
    behavior = settings.user_respond_timeout_behavior
    max_retries = settings.user_respond_retry_max_attempts if behavior == "retry" else 0

    request_id = str(uuid4())
    max_loops = max_retries + 1

    for attempt in range(max_loops):
        future = tracker.register_future(
            task.bonsai_sid,
            request_id,
            timeout_seconds=float(timeout) if timeout > 0 else 0.0,
        )
        if tracker.get_task(task.bonsai_sid).status != "waiting":
            tracker.set_status(task.bonsai_sid, "waiting")
        await notify(method, {**params, "attempt": attempt}, request_id=request_id)
        response = await future

        if not response.get("timed_out"):
            # User answered (or explicitly denied) — restore running status
            tracker.set_status(task.bonsai_sid, "running")
            return response, request_id

        # Timed out — retry if configured, otherwise finish
        if behavior == "retry" and attempt < max_retries:
            logger.info(
                "Retrying user response for session %s request %s (attempt %d/%d)",
                task.bonsai_sid[:8], request_id[:8], attempt + 1, max_retries,
            )
            continue

        # Final timeout: expire the request and restore running status
        await notify("agent/requestExpired", {
            "bonsaiSid": task.bonsai_sid,
            "requestId": request_id,
            "reason": "timeout",
        })
        tracker.set_status(task.bonsai_sid, "running")
        return None, request_id

    # Safety net (should not reach here)
    tracker.set_status(task.bonsai_sid, "running")
    return None, request_id


async def can_use_tool(
    tool_name: str,
    input_data: dict[str, Any],
    context: ToolPermissionContext,
    *,
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
    tool_use_id: str | None = None,
) -> PermissionResultAllow | PermissionResultDeny:
    """Route tool permission requests to the appropriate handler.

    Dispatch order:
    1. INTERCEPTORS — suffix-matched MCP tool interceptors (auto-approve).
       All real tool logic lives in handlers via get_tool_context().
    2. AskUserQuestion — SDK built-in, interactive (Future + card).
    3. Default — generic tool approval via agent/confirmAction.
    """
    # MCP tools: dispatch via INTERCEPTORS registry (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task, config)

    # Built-in: AskUserQuestion
    if tool_name == "AskUserQuestion":
        response, _request_id = await _await_user_response(
            tracker, notify, task, config,
            method="agent/askUserQuestion",
            params={"bonsaiSid": task.bonsai_sid, "questions": input_data.get("questions", [])},
        )
        if response is None:
            # Timeout — interrupt or deny based on configured behavior
            settings = load_settings(config.project_root)
            return PermissionResultDeny(
                behavior="deny",
                message="Timed out waiting for user response",
                interrupt=settings.user_respond_timeout_behavior != "deny",
            )
        if response.get("behavior") == "deny":
            return PermissionResultDeny(
                behavior="deny",
                message=response.get("message", "Denied by user"),
                interrupt=response.get("interrupt", False),
            )
        return PermissionResultAllow(
            behavior="allow",
            updated_input={
                "questions": response.get("questions", []),
                "answers": response.get("answers", {}),
            },
        )

    # Default: generic tool approval
    else:
        response, _request_id = await _await_user_response(
            tracker, notify, task, config,
            method="agent/confirmAction",
            params={
                "bonsaiSid": task.bonsai_sid,
                "toolName": tool_name,
                "toolInput": input_data,
                "toolUseId": tool_use_id,
            },
        )
        if response is None:
            # Timeout — interrupt or deny based on configured behavior
            settings = load_settings(config.project_root)
            return PermissionResultDeny(
                behavior="deny",
                message="Timed out waiting for user response",
                interrupt=settings.user_respond_timeout_behavior != "deny",
            )
        if response.get("behavior") == "allow":
            return PermissionResultAllow(behavior="allow")
        else:
            return PermissionResultDeny(
                behavior="deny",
                message=response.get("message", "Denied by user"),
                interrupt=response.get("interrupt", False),
            )
