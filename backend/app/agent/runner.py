from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolPermissionContext,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from app.agent.models import AgentEvent, AgentResult, AgentTask
from app.agent.tracker import Tracker


async def run(
    task: AgentTask,
    spec_context: str,
    notify: Callable,
    tracker: Tracker,
) -> AgentResult:
    """Execute an agent run using the Claude Agent SDK.

    Iterates the SDK event stream, maps SDK events to AgentEvent
    notifications, and handles canUseTool for interactive flows.
    """
    start_time = time.monotonic()

    async def can_use_tool(
        tool_name: str,
        input_data: dict[str, Any],
        context: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        if tool_name == "AskUserQuestion":
            request_id = str(uuid4())
            await notify(
                "agent/askUserQuestion",
                {"taskId": task.id, "questions": input_data.get("questions", [])},
                request_id=request_id,
            )
            future = tracker.register_future(task.id, request_id)
            response = await future
            return PermissionResultAllow(
                behavior="allow",
                updated_input={
                    "questions": response.get("questions", []),
                    "answers": response.get("answers", {}),
                },
            )
        else:
            request_id = str(uuid4())
            await notify(
                "agent/confirmAction",
                {
                    "taskId": task.id,
                    "toolName": tool_name,
                    "toolInput": input_data,
                },
                request_id=request_id,
            )
            future = tracker.register_future(task.id, request_id)
            response = await future
            if response.get("behavior") == "allow":
                return PermissionResultAllow(behavior="allow")
            else:
                return PermissionResultDeny(
                    behavior="deny",
                    message=response.get("message", "Denied by user"),
                    interrupt=response.get("interrupt", False),
                )

    options = ClaudeAgentOptions(
        system_prompt=spec_context,
        model=task.config.model,
        max_turns=task.config.max_turns,
        permission_mode=task.config.permission_mode,
        can_use_tool=can_use_tool,
        include_partial_messages=task.config.stream_text,
    )

    session_id = ""

    async with ClaudeSDKClient(options=options) as client:
        await client.query(f"Execute the task with spec IDs: {', '.join(task.spec_ids)}")

        async for message in client.receive_response():
            if isinstance(message, SystemMessage) and message.subtype == "init":
                session_id = message.data.get("session_id", "")
                tracker.set_session_id(task.id, session_id)
                await notify(
                    "agent/sessionStart",
                    AgentEvent(
                        task_id=task.id,
                        session_id=session_id,
                        event_type="session_start",
                        payload=message.data,
                    ).model_dump(),
                )

            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        await notify(
                            "agent/textDelta",
                            AgentEvent(
                                task_id=task.id,
                                session_id=session_id,
                                event_type="text_delta",
                                payload={"text": block.text},
                            ).model_dump(),
                        )
                    elif isinstance(block, ToolUseBlock):
                        await notify(
                            "agent/toolCallStart",
                            AgentEvent(
                                task_id=task.id,
                                session_id=session_id,
                                event_type="tool_call_start",
                                payload={
                                    "tool_use_id": block.id,
                                    "tool_name": block.name,
                                    "tool_input": block.input,
                                },
                            ).model_dump(),
                        )

            elif isinstance(message, UserMessage):
                content = message.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            await notify(
                                "agent/toolCallEnd",
                                AgentEvent(
                                    task_id=task.id,
                                    session_id=session_id,
                                    event_type="tool_call_end",
                                    payload={
                                        "tool_use_id": block.tool_use_id,
                                        "content": block.content if isinstance(block.content, str) else str(block.content),
                                        "is_error": block.is_error or False,
                                    },
                                ).model_dump(),
                            )

            elif isinstance(message, ResultMessage):
                duration_ms = int((time.monotonic() - start_time) * 1000)
                result = AgentResult(
                    task_id=task.id,
                    session_id=message.session_id or session_id,
                    result=message.result or "",
                    cost_usd=message.total_cost_usd or 0.0,
                    turns=message.num_turns,
                    duration_ms=duration_ms,
                    usage=message.usage or {},
                )
                event_type = "error" if message.is_error else "done"
                await notify(
                    f"agent/{event_type}",
                    AgentEvent(
                        task_id=task.id,
                        session_id=message.session_id or session_id,
                        event_type=event_type,
                        payload=result.model_dump(),
                    ).model_dump(),
                )
                return result

    # Fallback if no ResultMessage received
    duration_ms = int((time.monotonic() - start_time) * 1000)
    return AgentResult(
        task_id=task.id,
        session_id=session_id,
        result="",
        cost_usd=0.0,
        turns=0,
        duration_ms=duration_ms,
    )
