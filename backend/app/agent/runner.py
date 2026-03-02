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

from app.agent.models import AgentEvent, AgentResult, AgentTask, to_camel
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

    # Ask the frontend for the initial prompt via the Future mechanism
    prompt_request_id = str(uuid4())
    await notify(
        "agent/askUserQuestion",
        {
            "taskId": task.id,
            "requestId": prompt_request_id,
            "questions": [
                {
                    "question": "What would you like the agent to do?",
                    "header": "Prompt",
                    "options": [],
                    "multiSelect": False,
                }
            ],
        },
        request_id=prompt_request_id,
    )
    prompt_future = tracker.register_future(task.id, prompt_request_id)
    prompt_response = await prompt_future
    user_prompt = prompt_response.get("text", "")
    if not user_prompt:
        # Fallback: check answers dict
        answers = prompt_response.get("answers", {})
        user_prompt = next(iter(answers.values()), "") if answers else ""

    session_id = ""

    async with ClaudeSDKClient(options=options) as client:
        await client.query(user_prompt)

        async for message in client.receive_response():
            if isinstance(message, SystemMessage) and message.subtype == "init":
                session_id = message.data.get("session_id", "")
                tracker.set_session_id(task.id, session_id)
                sdk_data = {to_camel(k): v for k, v in message.data.items()}
                await notify("agent/sessionStart", {
                    "taskId": task.id,
                    "sessionId": session_id,
                    **sdk_data,
                })

            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        await notify("agent/textDelta", {
                            "taskId": task.id,
                            "sessionId": session_id,
                            "text": block.text,
                        })
                    elif isinstance(block, ToolUseBlock):
                        await notify("agent/toolCallStart", {
                            "taskId": task.id,
                            "sessionId": session_id,
                            "toolUseId": block.id,
                            "toolName": block.name,
                            "toolInput": block.input,
                        })

            elif isinstance(message, UserMessage):
                content = message.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, ToolResultBlock):
                            await notify("agent/toolCallEnd", {
                                "taskId": task.id,
                                "sessionId": session_id,
                                "toolUseId": block.tool_use_id,
                                "toolName": "",
                                "output": block.content if isinstance(block.content, str) else str(block.content),
                                "isError": block.is_error or False,
                            })

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
                await notify(f"agent/{event_type}", {
                    "taskId": task.id,
                    "sessionId": message.session_id or session_id,
                    "result": message.result or "",
                    "costUsd": message.total_cost_usd or 0.0,
                    "turns": message.num_turns,
                    "durationMs": duration_ms,
                    "usage": message.usage or {},
                    "subtype": event_type,
                    "errors": [message.result] if message.is_error else [],
                })
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
