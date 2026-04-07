from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from functools import partial
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import StreamEvent

from app.agent.models import AgentResult, AgentTask, to_camel
from app.agent.pricing import estimate_cost
from app.agent.permissions import can_use_tool
from app.agent.tools import MCP_SERVERS
from app.agent.tools._context import set_tool_context
from app.agent.tracker import END_SIGNAL, Tracker

logger = logging.getLogger(__name__)


def _serialize_tool_content(content: Any) -> str:
    """Serialize a ToolResultBlock.content to a clean string.

    MCP tools return content as a list of content blocks
    (e.g. [{'type': 'text', 'text': '...'}]).  Rather than calling str()
    which produces Python repr with single quotes, extract the text
    from text blocks and join them.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(parts) if parts else str(content)
    return str(content) if content is not None else ""


async def run(
    task: AgentTask,
    spec_context: str,
    notify: Callable,
    tracker: Tracker,
    cwd: Any = None,
    plugin_dir: Any = None,
    resume_session_id: str | None = None,
    config: Any = None,
) -> AgentResult:
    """Execute a persistent conversational agent session.

    Keeps the SDK client open and loops: wait for user message (via
    tracker queue) → query SDK → stream events → emit turnComplete →
    repeat. Exits when END_SIGNAL is received or an error occurs.
    """
    start_time = time.monotonic()
    total_cost = 0.0
    total_turns = 0

    # -- Subagent lifecycle hooks --
    # Track active subagents so we can emit synthetic subagentEnd events
    # when a turn is interrupted (the SDK's SubagentStop hook isn't
    # guaranteed to fire on interrupt).
    _active_subagent_ids: set[str] = set()
    # Maps parent_tool_use_id (from SDK messages) → agent_id so the
    # frontend can group events under the correct SubagentBlock.
    _parent_to_agent: dict[str, str] = {}
    # Queue of Task ToolUseBlock.id values awaiting their SubagentStart hook.
    # Each Task tool call triggers exactly one SubagentStart in order.
    _pending_task_tool_ids: list[str] = []

    async def on_subagent_start(hook_input: Any, tool_use_id: str | None, context: Any) -> dict:
        agent_id = hook_input["agent_id"]
        _active_subagent_ids.add(agent_id)
        # Correlate this subagent with its Task tool call so we can
        # resolve parent_tool_use_id → agentId on subsequent messages.
        if _pending_task_tool_ids:
            parent_id = _pending_task_tool_ids.pop(0)
            _parent_to_agent[parent_id] = agent_id
        await notify("agent/subagentStart", {
            "bonsaiSid": task.bonsai_sid,
            "sessionId": session_id,
            "agentId": agent_id,
            "agentType": hook_input["agent_type"],
        })
        return {}

    async def on_subagent_stop(hook_input: Any, tool_use_id: str | None, context: Any) -> dict:
        _active_subagent_ids.discard(hook_input["agent_id"])
        await notify("agent/subagentEnd", {
            "bonsaiSid": task.bonsai_sid,
            "sessionId": session_id,
            "agentId": hook_input["agent_id"],
        })
        return {}

    def _resolve_agent_id(parent_tool_use_id: str | None) -> str | None:
        """Resolve SDK parent_tool_use_id to our agentId."""
        if parent_tool_use_id is None:
            return None
        return _parent_to_agent.get(parent_tool_use_id)

    async def _close_orphaned_subagents() -> None:
        """Emit synthetic subagentEnd for any subagents still open."""
        for orphan_id in list(_active_subagent_ids):
            await notify("agent/subagentEnd", {
                "bonsaiSid": task.bonsai_sid,
                "sessionId": session_id,
                "agentId": orphan_id,
            })
        _active_subagent_ids.clear()
        _pending_task_tool_ids.clear()

    plugins = []
    if plugin_dir and Path(plugin_dir).is_dir():
        plugins.append({"type": "local", "path": str(plugin_dir)})

    # Set tool context BEFORE SDK client creation so that MCP tool handlers
    # can access session state (tracker, notify, task, config) via
    # get_tool_context().  This is critical for yolo mode where the CLI
    # bypasses canUseTool and invokes MCP tools directly.
    set_tool_context(tracker, notify, task, config)

    def _on_cli_stderr(line: str) -> None:
        logger.debug("CLI stderr: %s", line)

    options = ClaudeAgentOptions(
        system_prompt=spec_context,
        model=task.config.model,
        max_turns=task.config.max_turns,
        permission_mode=task.config.permission_mode,
        can_use_tool=partial(can_use_tool, tracker=tracker, notify=notify, task=task, config=config),
        include_partial_messages=task.config.stream_text,
        cwd=str(cwd) if cwd else None,
        plugins=plugins,
        mcp_servers=MCP_SERVERS,
        resume=resume_session_id,
        stderr=_on_cli_stderr,
        betas=task.config.betas,
        effort=task.config.effort,
        hooks={
            "SubagentStart": [HookMatcher(hooks=[on_subagent_start])],
            "SubagentStop": [HookMatcher(hooks=[on_subagent_stop])],
        },
    )

    session_id = ""

    t0 = time.monotonic()
    async with ClaudeSDKClient(options=options) as client:
        sdk_init_ms = int((time.monotonic() - t0) * 1000)
        logger.info("[%s] SDK client ready in %dms", task.bonsai_sid[:8], sdk_init_ms)
        tracker.set_client(task.bonsai_sid, client)
        tracker.set_status(task.bonsai_sid, "idle")
        await notify("agent/ready", {
            "bonsaiSid": task.bonsai_sid,
        })
        # Track tool calls that change permission mode (ExitPlanMode, EnterPlanMode)
        # so we can notify the frontend when the SDK changes mode internally.
        _mode_change_tools: dict[str, str] = {}  # tool_use_id → new permission_mode
        try:
            # -- conversation loop --
            while True:
                message = await tracker.get_next_message(task.bonsai_sid)

                if message is END_SIGNAL:
                    break

                tracker.set_status(task.bonsai_sid, "running")
                tracker.clear_turn_text(task.bonsai_sid)
                turn_t0 = time.monotonic()
                turn_input = turn_output = turn_cache_write_5m = turn_cache_write_1h = turn_cache_read = 0
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
                                "systemPrompt": spec_context,
                                **sdk_data,
                            })

                    elif isinstance(sdk_event, AssistantMessage):
                        agent_id = _resolve_agent_id(sdk_event.parent_tool_use_id)
                        for block in sdk_event.content:
                            if isinstance(block, TextBlock):
                                tracker.append_turn_text(task.bonsai_sid, block.text)
                                msg: dict[str, Any] = {
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "text": block.text,
                                }
                                if agent_id:
                                    msg["agentId"] = agent_id
                                await notify("agent/textDelta", msg)
                            elif isinstance(block, ToolUseBlock):
                                # Track Task tool calls so we can correlate
                                # them with SubagentStart hooks.
                                if block.name == "Task":
                                    _pending_task_tool_ids.append(block.id)
                                if block.name == "ExitPlanMode":
                                    _mode_change_tools[block.id] = "default"
                                elif block.name == "EnterPlanMode":
                                    _mode_change_tools[block.id] = "plan"
                                tool_input = dict(block.input) if isinstance(block.input, dict) else block.input
                                if block.name == "Write" and isinstance(tool_input, dict):
                                    file_path = tool_input.get("file_path", "")
                                    if file_path:
                                        try:
                                            target = Path(file_path) if Path(file_path).is_absolute() else Path(cwd or ".") / file_path
                                            if target.is_file():
                                                tool_input["_previousContent"] = target.read_text(encoding="utf-8", errors="replace")
                                            else:
                                                tool_input["_previousContent"] = ""
                                        except Exception:
                                            tool_input["_previousContent"] = ""
                                tc_msg: dict[str, Any] = {
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "toolUseId": block.id,
                                    "toolName": block.name,
                                    "toolInput": tool_input,
                                }
                                if agent_id:
                                    tc_msg["agentId"] = agent_id
                                await notify("agent/toolCallStart", tc_msg)

                    elif isinstance(sdk_event, UserMessage):
                        agent_id = _resolve_agent_id(sdk_event.parent_tool_use_id)
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
                                            "effort": task.config.effort,
                                        })
                                    te_msg: dict[str, Any] = {
                                        "bonsaiSid": task.bonsai_sid,
                                        "sessionId": session_id,
                                        "toolUseId": block.tool_use_id,
                                        "toolName": "",
                                        "output": _serialize_tool_content(block.content),
                                        "isError": block.is_error or False,
                                    }
                                    if agent_id:
                                        te_msg["agentId"] = agent_id
                                    await notify("agent/toolCallEnd", te_msg)

                    elif isinstance(sdk_event, StreamEvent):
                        raw = sdk_event.event
                        etype = raw.get("type")
                        if etype == "message_start":
                            u = raw.get("message", {}).get("usage", {})
                            turn_input += u.get("input_tokens", 0)
                            turn_cache_read += u.get("cache_read_input_tokens", 0)
                            cc = u.get("cache_creation", {})
                            if cc:
                                turn_cache_write_5m += cc.get("ephemeral_5m_input_tokens", 0)
                                turn_cache_write_1h += cc.get("ephemeral_1h_input_tokens", 0)
                            else:
                                # Older API: no breakdown — treat all writes as 5m
                                turn_cache_write_5m += u.get("cache_creation_input_tokens", 0)
                        elif etype == "message_delta":
                            u = raw.get("usage", {})
                            turn_output += u.get("output_tokens", 0)

                        if etype in ("message_start", "message_delta"):
                            est = estimate_cost(
                                task.config.model, turn_input, turn_output,
                                turn_cache_write_5m, turn_cache_write_1h, turn_cache_read,
                            )
                            await notify("agent/costEstimate", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": session_id,
                                "estimatedTurnCostUsd": est,
                                "estimatedCostUsd": total_cost + est,
                            })

                    elif isinstance(sdk_event, ResultMessage):
                        turn_ms = int((time.monotonic() - turn_t0) * 1000)
                        logger.info("[%s] turn completed in %dms (cost=$%.4f)",
                                    task.bonsai_sid[:8], turn_ms, sdk_event.total_cost_usd or 0.0)
                        final_est = estimate_cost(
                            task.config.model, turn_input, turn_output,
                            turn_cache_write_5m, turn_cache_write_1h, turn_cache_read,
                        )
                        logger.debug(
                            "[%s] cost detail: sdk=$%.4f est=$%.4f "
                            "in=%d out=%d cw5m=%d cw1h=%d cr=%d turns=%d",
                            task.bonsai_sid[:8],
                            sdk_event.total_cost_usd or 0.0, final_est,
                            turn_input, turn_output,
                            turn_cache_write_5m, turn_cache_write_1h, turn_cache_read,
                            sdk_event.num_turns or 0,
                        )
                        turn_cost = sdk_event.total_cost_usd or 0.0
                        turn_turns = sdk_event.num_turns
                        total_cost += turn_cost
                        total_turns += turn_turns
                        duration_ms = int((time.monotonic() - start_time) * 1000)

                        # Check if this ResultMessage came from an interrupt
                        interrupted = tracker.is_interrupted(task.bonsai_sid)
                        if interrupted:
                            tracker.clear_interrupted(task.bonsai_sid)

                        if sdk_event.is_error and not interrupted:
                            # Send error notification but DON'T terminate the session.
                            # Go back to idle so the user can send another message.
                            await notify("agent/error", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "subtype": "turn_error",
                                "errors": [sdk_event.result] if sdk_event.result else [],
                                "result": sdk_event.result or "",
                                "turnCostUsd": turn_cost,
                                "turn_turns": turn_turns,
                                "costUsd": total_cost,
                                "turns": total_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                            })
                        elif interrupted:
                            # Interrupt path — emit interrupted, not turnComplete.
                            # Same client, same context — runner goes back to idle.
                            # Close any subagents left open (SubagentStop hook may
                            # not fire when the SDK is interrupted mid-turn).
                            await _close_orphaned_subagents()
                            await notify("agent/interrupted", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "turnCostUsd": turn_cost,
                                "turn_turns": turn_turns,
                                "costUsd": total_cost,
                                "turns": total_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                            })
                        else:
                            await notify("agent/turnComplete", {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "result": sdk_event.result or "",
                                "turnCostUsd": turn_cost,
                                "turn_turns": turn_turns,
                                "costUsd": total_cost,
                                "turns": total_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                            })
                        tracker.set_status(task.bonsai_sid, "idle")
                        break  # back to conversation loop, same client
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
