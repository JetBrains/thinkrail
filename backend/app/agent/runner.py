from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from pathlib import Path
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

from app.agent.models import AgentResult, AgentTask, to_camel
from app.agent.tracker import END_SIGNAL, Tracker


async def run(
    task: AgentTask,
    spec_context: str,
    notify: Callable,
    tracker: Tracker,
    cwd: Any = None,
    plugin_dir: Any = None,
    resume_session_id: str | None = None,
) -> AgentResult:
    """Execute a persistent conversational agent session.

    Keeps the SDK client open and loops: wait for user message (via
    tracker queue) → query SDK → stream events → emit turnComplete →
    repeat. Exits when END_SIGNAL is received or an error occurs.
    """
    start_time = time.monotonic()
    total_cost = 0.0
    total_turns = 0

    async def can_use_tool(
        tool_name: str,
        input_data: dict[str, Any],
        context: ToolPermissionContext,
    ) -> PermissionResultAllow | PermissionResultDeny:
        if tool_name == "AskUserQuestion":
            request_id = str(uuid4())
            future = tracker.register_future(task.bonsai_sid, request_id)
            await notify(
                "agent/askUserQuestion",
                {"bonsaiSid": task.bonsai_sid, "questions": input_data.get("questions", [])},
                request_id=request_id,
            )
            response = await future
            # Check for timeout auto-deny
            if response.get("behavior") == "deny":
                return PermissionResultDeny(
                    behavior="deny",
                    message=response.get("message", "Timed out"),
                    interrupt=response.get("interrupt", False),
                )
            return PermissionResultAllow(
                behavior="allow",
                updated_input={
                    "questions": response.get("questions", []),
                    "answers": response.get("answers", {}),
                },
            )
        else:
            request_id = str(uuid4())
            future = tracker.register_future(task.bonsai_sid, request_id)
            await notify(
                "agent/confirmAction",
                {
                    "bonsaiSid": task.bonsai_sid,
                    "toolName": tool_name,
                    "toolInput": input_data,
                },
                request_id=request_id,
            )
            response = await future
            if response.get("behavior") == "allow":
                return PermissionResultAllow(behavior="allow")
            else:
                return PermissionResultDeny(
                    behavior="deny",
                    message=response.get("message", "Denied by user"),
                    interrupt=response.get("interrupt", False),
                )

    plugins = []
    if plugin_dir and Path(plugin_dir).is_dir():
        plugins.append({"type": "local", "path": str(plugin_dir)})

    options = ClaudeAgentOptions(
        system_prompt=spec_context,
        model=task.config.model,
        max_turns=task.config.max_turns,
        permission_mode=task.config.permission_mode,
        can_use_tool=can_use_tool,
        include_partial_messages=task.config.stream_text,
        cwd=str(cwd) if cwd else None,
        plugins=plugins,
        resume=resume_session_id,
    )

    session_id = ""

    async with ClaudeSDKClient(options=options) as client:
        tracker.set_client(task.bonsai_sid, client)
        # Track tool calls that change permission mode (ExitPlanMode, EnterPlanMode)
        # so we can notify the frontend when the SDK changes mode internally.
        _mode_change_tools: dict[str, str] = {}  # tool_use_id → new permission_mode
        try:
            # Wait for init message to get session_id
            # The SDK may emit SystemMessage(init) before the first query,
            # or after — handle both cases in the event loop below.

            # Task starts in idle — ready for first message
            # -- conversation loop --
            while True:
                message = await tracker.get_next_message(task.bonsai_sid)

                if message is END_SIGNAL:
                    break

                tracker.set_status(task.bonsai_sid, "running")
                await client.query(message)

                async for sdk_event in client.receive_response():
                    if isinstance(sdk_event, SystemMessage) and sdk_event.subtype == "init":
                        new_sid = sdk_event.data.get("session_id", "")
                        first_init = not session_id
                        session_id = new_sid
                        tracker.set_session_id(task.bonsai_sid, session_id)
                        if first_init:
                            sdk_data = {to_camel(k): v for k, v in sdk_event.data.items()}
                            await notify("agent/sessionStart", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": session_id,
                                **sdk_data,
                            })

                    elif isinstance(sdk_event, AssistantMessage):
                        for block in sdk_event.content:
                            if isinstance(block, TextBlock):
                                await notify("agent/textDelta", {
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "text": block.text,
                                })
                            elif isinstance(block, ToolUseBlock):
                                if block.name == "ExitPlanMode":
                                    _mode_change_tools[block.id] = "default"
                                elif block.name == "EnterPlanMode":
                                    _mode_change_tools[block.id] = "plan"
                                await notify("agent/toolCallStart", {
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "toolUseId": block.id,
                                    "toolName": block.name,
                                    "toolInput": block.input,
                                })

                    elif isinstance(sdk_event, UserMessage):
                        content = sdk_event.content
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, ToolResultBlock):
                                    # Detect SDK-internal permission mode changes
                                    new_mode = _mode_change_tools.pop(block.tool_use_id, None)
                                    if new_mode and not (block.is_error or False):
                                        task.config.permission_mode = new_mode
                                        await notify("agent/configChanged", {
                                            "bonsaiSid": task.bonsai_sid,
                                            "model": task.config.model,
                                            "permissionMode": new_mode,
                                        })
                                    await notify("agent/toolCallEnd", {
                                        "bonsaiSid": task.bonsai_sid,
                                        "sessionId": session_id,
                                        "toolUseId": block.tool_use_id,
                                        "toolName": "",
                                        "output": block.content if isinstance(block.content, str) else str(block.content),
                                        "isError": block.is_error or False,
                                    })

                    elif isinstance(sdk_event, ResultMessage):
                        turn_cost = sdk_event.total_cost_usd or 0.0
                        turn_turns = sdk_event.num_turns
                        total_cost += turn_cost
                        total_turns += turn_turns
                        duration_ms = int((time.monotonic() - start_time) * 1000)

                        if sdk_event.is_error:
                            # Send error notification but DON'T terminate the session.
                            # Go back to idle so the user can send another message.
                            await notify("agent/error", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "subtype": "turn_error",
                                "errors": [sdk_event.result] if sdk_event.result else [],
                                "result": sdk_event.result or "",
                                "costUsd": total_cost,
                                "turns": total_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                            })
                            tracker.set_status(task.bonsai_sid, "idle")
                            break  # back to conversation loop, wait for next message
                        else:
                            await notify("agent/turnComplete", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "result": sdk_event.result or "",
                                "costUsd": turn_cost,
                                "turns": turn_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                            })
                            tracker.set_status(task.bonsai_sid, "idle")
                            break  # turn done, go back to waiting
        finally:
            tracker.clear_client(task.bonsai_sid)

    # Session closed gracefully (END_SIGNAL received)
    duration_ms = int((time.monotonic() - start_time) * 1000)
    await notify("agent/done", {
        "bonsaiSid": task.bonsai_sid,
        "sessionId": session_id,
        "result": "",
        "costUsd": total_cost,
        "turns": total_turns,
        "durationMs": duration_ms,
        "usage": {},
    })

    return AgentResult(
        bonsai_sid=task.bonsai_sid,
        session_id=session_id,
        result="",
        cost_usd=total_cost,
        turns=total_turns,
        duration_ms=duration_ms,
    )
