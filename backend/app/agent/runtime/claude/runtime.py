"""`ClaudeRuntime` — concrete `IAgentRuntime` backed by the Claude Agent SDK.

The conversational loop is owned by ``run_session``; direct event emission
goes through ``handler.on_event(RuntimeEvent(...))``. A local ``notify`` shim
adapts that to the ``(method, params, request_id=...)`` signature still
expected by ``set_tool_context`` and ``claude_can_use_tool_adapter``.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, get_args

from claude_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    EffortLevel,
    HookMatcher,
    PermissionMode,
    PermissionResultAllow,
    PermissionResultDeny,
    ResultMessage,
    SdkBeta,
    SystemMessage,
    TextBlock,
    ToolPermissionContext,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import StreamEvent

from app.agent.models import AgentResult, AgentTask, to_camel
from app.agent.permissions import claude_can_use_tool_adapter
from app.agent.pricing import estimate_cost
from app.agent.subagents import TICKET_STEP_EXECUTOR


def _build_agents_for(task: AgentTask) -> dict[str, AgentDefinition]:
    """Return SDK agent definitions to register for ``task``.

    Currently empty for every session except ticket-implement orchestrators
    running in subagent mode, which gets the ``ticket-step-executor``
    registered so the orchestrator's ``Task`` calls can target it.
    """
    if task.skill_id == "ticket-implement" and task.subagent_mode == "subagent":
        return {"ticket-step-executor": TICKET_STEP_EXECUTOR}
    return {}
from app.agent.runtime.claude.adapter import (
    build_text_delta_params,
    build_tool_call_end_params,
    build_tool_call_start_params,
)
from app.agent.runtime.claude.hooks import SubagentHooks
from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.claude.skills import ClaudeSkillRegistry
from app.agent.runtime.events import RuntimeEvent
from app.agent.runtime.types import (
    LabeledOption,
    RuntimeCapabilities,
    RuntimeFlag,
    RuntimeSkillInfo,
    RuntimeType,
)
from app.agent.tools import MCP_SERVERS
from app.agent.tools._context import set_tool_context
from app.agent.tracker import END_SIGNAL, Tracker

if TYPE_CHECKING:
    from app.agent.runtime.events import AgentEventHandler
    from app.agent.runtime.types import RuntimeExecutionConfig
    from app.core.config import AppConfig

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


# Permission modes and effort levels are sourced from the SDK's own value sets,
# so the picker can't drift from what the runtime actually accepts; the value
# doubles as the display label. Position 0 is the default; the SDK lists
# ``default`` first. The SDK has no name for "no explicit effort" (its default
# ``effort=None``), so Bonsai prepends ``"auto"`` for it and translates back at
# the call boundary.
_CLAUDE_PERMISSION_MODES: tuple[LabeledOption, ...] = tuple(
    LabeledOption(value=v, label=v) for v in get_args(PermissionMode)
)

_CLAUDE_EFFORT_LEVELS: tuple[LabeledOption, ...] = (
    LabeledOption(value="auto", label="auto"),
    *(LabeledOption(value=v, label=v) for v in get_args(EffortLevel)),
)

# The 1M-token context window is opt-out (on by default). Models that support
# it (Opus 4.8, Sonnet 4.6) extend to 1M; models that don't (Haiku) ignore the
# beta and stay at their default — the real window is read back from the live
# client via get_context_usage(). Disabling the flag caps a session at 200k.
_CONTEXT_1M_FLAG = "context1m"
_CONTEXT_1M_BETA: SdkBeta = "context-1m-2025-08-07"

_CLAUDE_FLAGS: tuple[RuntimeFlag, ...] = (
    RuntimeFlag(
        key=_CONTEXT_1M_FLAG,
        label="1M context window",
        type="boolean",
        default=True,
        description="Request the 1M-token context window on models that support it (Opus 4.8, Sonnet 4.6). Off caps the session at 200K.",
    ),
)


class ClaudeRuntime:
    """Claude Agent SDK runtime — implements ``IAgentRuntime``.

    The conversational loop is owned by ``run_session``. Per-session state
    (tracker queue, MCP tool context, subagent correlation maps) is reset
    each call; runtime-level dependencies (tracker, plugin dir, model
    registry, spec service, coordinator) come in via ``__init__`` so that
    ``AgentService`` can construct one ``ClaudeRuntime`` per service
    lifetime and re-use it for every session.
    """

    runtime_type: RuntimeType = "claude"
    display_name: str = "Claude Code"

    def __init__(
        self,
        *,
        app_config: AppConfig,
        tracker: Tracker | None = None,
        plugin_dir: Path | None = None,
        spec_service: Any = None,
        coordinator: Any = None,
    ) -> None:
        self.tracker = tracker
        self.app_config = app_config
        self.plugin_dir = plugin_dir
        self.spec_service = spec_service
        self.coordinator = coordinator
        # The Claude runtime owns its own model + skill registries.
        # ``IAgentRuntime`` exposes only the public surface
        # (``capabilities``, ``list_skills`` etc.); the registry instances
        # are private to this class.
        self._models = ClaudeModelRegistry()
        self._skills = ClaudeSkillRegistry(project_root=app_config.project_root)

    # ── IAgentRuntime: capability surface ────────────────────────────────

    def capabilities(self) -> RuntimeCapabilities:
        return RuntimeCapabilities(
            permission_modes=list(_CLAUDE_PERMISSION_MODES),
            effort_levels=list(_CLAUDE_EFFORT_LEVELS),
            models=self._models.list_options(),
            flags=list(_CLAUDE_FLAGS),
        )

    # ── IAgentRuntime: skill surface ─────────────────────────────────────

    def list_skills(self) -> list[RuntimeSkillInfo]:
        return self._skills.list_skills()

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult:
        """Execute a persistent conversational agent session.

        Keeps the SDK client open and loops: wait for user message (via
        tracker queue) → query SDK → stream events → emit turnComplete →
        repeat. Exits when END_SIGNAL is received or an error occurs.
        """
        tracker = self.tracker
        if tracker is None:
            raise RuntimeError("ClaudeRuntime.run_session requires a tracker")
        plugin_dir = self.plugin_dir
        spec_service = self.spec_service
        coordinator = self.coordinator
        config = self.app_config
        spec_context = exec_config.system_prompt or ""
        cwd = exec_config.working_directory
        resume_session_id = exec_config.resume_session_id

        async def notify(method: str, params: dict, request_id: str | None = None) -> None:
            await handler.on_event(
                RuntimeEvent(method=method, params=params, request_id=request_id)
            )

        start_time = time.monotonic()
        total_cost = 0.0
        total_turns = 0

        # Subagent lifecycle hooks — owns the parent_tool_use_id ↔ agent_id
        # correlation map and emits SubagentStart/Stop/PreCompact events.
        # The runtime updates ``hooks.session_id`` after SDK init and
        # ``hooks.iterations`` at the start of each turn.
        hooks = SubagentHooks(task, handler)

        plugins = []
        if plugin_dir and Path(plugin_dir).is_dir():
            plugins.append({"type": "local", "path": str(plugin_dir)})

        # Set tool context BEFORE SDK client creation so that MCP tool handlers
        # can access session state (tracker, notify, task, config) via
        # get_tool_context().  This is critical for yolo mode where the CLI
        # bypasses canUseTool and invokes MCP tools directly.
        set_tool_context(tracker, notify, task, config, spec_service=spec_service, coordinator=coordinator)

        def _on_cli_stderr(line: str) -> None:
            logger.debug("CLI stderr: %s", line)

        _pending_tool_ids: list[str] = []

        async def _can_use_tool(
            tool_name: str, input_data: dict[str, Any], context: ToolPermissionContext
        ) -> PermissionResultAllow | PermissionResultDeny:
            _tool_use_id = _pending_tool_ids.pop(0) if _pending_tool_ids else None
            return await claude_can_use_tool_adapter(
                tool_name, input_data, context,
                tool_use_id=_tool_use_id,
                tracker=tracker, notify=notify, task=task, config=config,
            )

        # Strip CLAUDECODE env var so the bundled CLI doesn't reject this as a nested session
        # (happens when the backend runs inside a Claude Code terminal during development)
        env_overrides = {k: "" for k in ("CLAUDECODE", "CLAUDE_CODE_EXECPATH") if k in os.environ}

        # Register the ticket-step-executor subagent when the orchestrator is
        # ticket-implement in subagent mode — see TICKET_LIFECYCLE_DESIGN.md
        # § Implementation orchestration modes.
        agents = _build_agents_for(task)

        options = ClaudeAgentOptions(
            system_prompt=spec_context,
            model=task.config.model,
            permission_mode=task.config.permission_mode,
            can_use_tool=_can_use_tool,
            include_partial_messages=task.config.stream_text,
            cwd=str(cwd) if cwd else None,
            plugins=plugins,
            mcp_servers=MCP_SERVERS,
            resume=resume_session_id,
            stderr=_on_cli_stderr,
            betas=([_CONTEXT_1M_BETA] if task.config.flags.get(_CONTEXT_1M_FLAG, True) else []),
            # The SDK uses ``effort=None`` for its automatic setting; the
            # neutral config value for that is the string ``"auto"``.
            effort=(None if task.config.effort == "auto" else task.config.effort),
            max_buffer_size=10 * 1024 * 1024,  # 10MB — default 1MB is too small for large tool results
            extra_args={"allow-dangerously-skip-permissions": None},  # enable mid-session mode switching to bypassPermissions
            hooks={
                "SubagentStart": [HookMatcher(hooks=[hooks.start_hook])],
                "SubagentStop": [HookMatcher(hooks=[hooks.stop_hook])],
                "PreCompact": [HookMatcher(hooks=[hooks.pre_compact_hook])],
            },
            **({"agents": agents} if agents else {}),
            **({"env": env_overrides} if env_overrides else {}),
        )

        session_id = ""
        # Model context window (usage-bar denominator), sourced from the live
        # client per ``_ctx_model``. 0 until the first successful fetch — the
        # frontend hides the bar while it's 0.
        context_max = 0
        _ctx_model = ""

        t0 = time.monotonic()
        async with ClaudeSDKClient(options=options) as client:
            sdk_init_ms = int((time.monotonic() - t0) * 1000)
            logger.info("[%s] SDK client ready in %dms", task.bonsai_sid[:8], sdk_init_ms)
            tracker.set_client(task.bonsai_sid, client)
            tracker.set_status(task.bonsai_sid, "idle")
            await handler.on_event(RuntimeEvent(method="agent/ready", params={
                "bonsaiSid": task.bonsai_sid,
            }))
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
                    await handler.on_event(RuntimeEvent(method="agent/statusChanged", params={
                        "bonsaiSid": task.bonsai_sid,
                        "status": "running",
                    }))
                    tracker.clear_turn_text(task.bonsai_sid)
                    turn_t0 = time.monotonic()
                    turn_input = turn_output = turn_cache_write_5m = turn_cache_write_1h = turn_cache_read = 0
                    # Per-iteration tracking — each API call within the turn
                    # gets its own entry.  The *last* iteration determines
                    # context-window occupancy; the *sum* drives cost estimation.
                    iterations: list[dict] = []
                    hooks.iterations = iterations

                    # Refresh the model's context window when the configured
                    # model changes (covers mid-session switches). rawMaxTokens
                    # is stable per model, so one control request per model is
                    # enough; the transport is idle between turns, so this never
                    # races the response stream below.
                    if task.config.model != _ctx_model:
                        try:
                            usage = await client.get_context_usage()
                            fetched = int(usage.get("rawMaxTokens") or 0)
                            if fetched > 0:
                                context_max = fetched
                                _ctx_model = task.config.model
                        except Exception:
                            logger.debug(
                                "[%s] get_context_usage failed; keeping last contextMax",
                                task.bonsai_sid[:8], exc_info=True,
                            )

                    await client.query(message)

                    async for sdk_event in client.receive_response():
                        if isinstance(sdk_event, SystemMessage) and sdk_event.subtype == "init":
                            new_sid = sdk_event.data.get("session_id", "")
                            first_init = not session_id
                            session_id = new_sid
                            hooks.session_id = session_id
                            tracker.set_session_id(task.bonsai_sid, session_id)
                            if first_init:
                                sdk_data = {to_camel(k): v for k, v in sdk_event.data.items()}
                                await handler.on_event(RuntimeEvent(method="agent/sessionStart", params={
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "systemPrompt": spec_context,
                                    **sdk_data,
                                }))

                        elif isinstance(sdk_event, AssistantMessage):
                            agent_id = hooks.resolve_agent_id(sdk_event.parent_tool_use_id)
                            for block in sdk_event.content:
                                if isinstance(block, TextBlock):
                                    tracker.append_turn_text(task.bonsai_sid, block.text)
                                    await handler.on_event(RuntimeEvent(
                                        method="agent/textDelta",
                                        params=build_text_delta_params(
                                            bonsai_sid=task.bonsai_sid,
                                            session_id=session_id,
                                            text=block.text,
                                            agent_id=agent_id,
                                        ),
                                    ))
                                elif isinstance(block, ToolUseBlock):
                                    # Track Task tool calls so we can correlate
                                    # them with SubagentStart hooks.
                                    if block.name == "Agent":
                                        hooks.record_task_tool_call(block.id)
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
                                    await handler.on_event(RuntimeEvent(
                                        method="agent/toolCallStart",
                                        params=build_tool_call_start_params(
                                            bonsai_sid=task.bonsai_sid,
                                            session_id=session_id,
                                            tool_use_id=block.id,
                                            tool_name=block.name,
                                            tool_input=tool_input,
                                            agent_id=agent_id,
                                        ),
                                    ))
                                    _pending_tool_ids.append(block.id)

                        elif isinstance(sdk_event, UserMessage):
                            agent_id = hooks.resolve_agent_id(sdk_event.parent_tool_use_id)
                            content = sdk_event.content
                            if isinstance(content, list):
                                for block in content:
                                    if isinstance(block, ToolResultBlock):
                                        # Detect SDK-internal permission mode changes
                                        new_mode = _mode_change_tools.pop(block.tool_use_id, None)
                                        if new_mode and not (block.is_error or False):
                                            task.config.permission_mode = new_mode
                                            await handler.on_event(RuntimeEvent(method="agent/configChanged", params={
                                                "bonsaiSid": task.bonsai_sid,
                                                "model": task.config.model,
                                                "permissionMode": new_mode,
                                                "effort": task.config.effort,
                                            }))
                                        await handler.on_event(RuntimeEvent(
                                            method="agent/toolCallEnd",
                                            params=build_tool_call_end_params(
                                                bonsai_sid=task.bonsai_sid,
                                                session_id=session_id,
                                                tool_use_id=block.tool_use_id,
                                                output=_serialize_tool_content(block.content),
                                                is_error=block.is_error or False,
                                                agent_id=agent_id,
                                            ),
                                        ))

                        elif isinstance(sdk_event, StreamEvent):
                            raw = sdk_event.event
                            etype = raw.get("type")
                            if etype == "message_start":
                                u = raw.get("message", {}).get("usage", {})
                                call_input = u.get("input_tokens", 0)
                                call_cache_read = u.get("cache_read_input_tokens", 0)
                                call_cache_create = u.get("cache_creation_input_tokens", 0)
                                turn_input += call_input
                                turn_cache_read += call_cache_read
                                cc = u.get("cache_creation", {})
                                if cc:
                                    turn_cache_write_5m += cc.get("ephemeral_5m_input_tokens", 0)
                                    turn_cache_write_1h += cc.get("ephemeral_1h_input_tokens", 0)
                                else:
                                    # Older API: no breakdown — treat all writes as 5m
                                    turn_cache_write_5m += u.get("cache_creation_input_tokens", 0)
                                # Start a new iteration record for this API call
                                iterations.append({
                                    "type": "message",
                                    "input_tokens": call_input,
                                    "output_tokens": 0,
                                    "cache_creation_input_tokens": call_cache_create,
                                    "cache_read_input_tokens": call_cache_read,
                                    "cache_creation": cc if cc else None,
                                })
                            elif etype == "message_delta":
                                u = raw.get("usage", {})
                                call_output = u.get("output_tokens", 0)
                                turn_output += call_output
                                if iterations:
                                    iterations[-1]["output_tokens"] = call_output

                            if etype in ("message_start", "message_delta"):
                                est = estimate_cost(
                                    task.config.model, turn_input, turn_output,
                                    turn_cache_write_5m, turn_cache_write_1h, turn_cache_read,
                                )
                                # Context window = all tokens in the latest
                                # API call (last iteration).
                                _last_iter = iterations[-1] if iterations else {}
                                _current_ctx = (
                                    _last_iter.get("input_tokens", 0)
                                    + _last_iter.get("cache_creation_input_tokens", 0)
                                    + _last_iter.get("cache_read_input_tokens", 0)
                                    + _last_iter.get("output_tokens", 0)
                                )
                                await handler.on_event(RuntimeEvent(method="agent/costEstimate", params={
                                    "bonsaiSid": task.bonsai_sid,
                                    "sessionId": session_id,
                                    "estimatedTurnCostUsd": est,
                                    "estimatedCostUsd": total_cost + est,
                                    # Cumulative turn totals (for cost display)
                                    "turnInputTokens": turn_input,
                                    "turnOutputTokens": turn_output,
                                    "turnCacheRead": turn_cache_read,
                                    "turnCacheWrite": turn_cache_write_5m + turn_cache_write_1h,
                                    # Context window from latest iteration
                                    "currentContextWindow": _current_ctx,
                                    # Latest iteration breakdown (for context display)
                                    "iterInputTokens": _last_iter.get("input_tokens", 0),
                                    "iterCacheRead": _last_iter.get("cache_read_input_tokens", 0),
                                    "iterCacheCreate": _last_iter.get("cache_creation_input_tokens", 0),
                                    "iterOutputTokens": _last_iter.get("output_tokens", 0),
                                }))

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
                            # total_cost_usd is CUMULATIVE — assign, derive per-turn delta
                            sdk_cost = sdk_event.total_cost_usd or 0.0
                            turn_cost = max(0.0, sdk_cost - total_cost)
                            total_cost = sdk_cost
                            # num_turns is PER-TURN — accumulate
                            turn_turns = sdk_event.num_turns or 0
                            total_turns += turn_turns
                            duration_ms = int((time.monotonic() - start_time) * 1000)

                            # Check if this ResultMessage came from an interrupt
                            interrupted = tracker.is_interrupted(task.bonsai_sid)
                            if interrupted:
                                tracker.clear_interrupted(task.bonsai_sid)

                            # Context window = total tokens in the last API
                            # call (last iteration), including cached tokens.
                            _last = iterations[-1] if iterations else {}
                            context_window = (
                                _last.get("input_tokens", 0)
                                + _last.get("cache_creation_input_tokens", 0)
                                + _last.get("cache_read_input_tokens", 0)
                                + _last.get("output_tokens", 0)
                            )

                            # Common fields for all turn-end events
                            _turn_event = {
                                "bonsaiSid": task.bonsai_sid,
                                "sessionId": sdk_event.session_id or session_id,
                                "turnCostUsd": turn_cost,
                                "turnTurns": turn_turns,
                                "costUsd": total_cost,
                                "turns": total_turns,
                                "durationMs": duration_ms,
                                "usage": sdk_event.usage or {},
                                "iterations": iterations,
                                "contextWindow": context_window,
                                "contextMax": context_max,
                            }

                            if sdk_event.is_error and not interrupted:
                                # Send error notification but DON'T terminate the session.
                                # Go back to idle so the user can send another message.
                                error_text = sdk_event.result or ""
                                _err_lower = error_text.lower()
                                is_context_overflow = (
                                    "prompt is too long" in _err_lower
                                    or "prompt_too_long" in _err_lower
                                    or "context window" in _err_lower
                                )
                                # When the SDK signals is_error with no `result` text,
                                # the most common cause is the model hitting its
                                # per-turn max_output_tokens cap, or a transient API
                                # condition. Surface a clearer message so the UI
                                # doesn't show a bare "turn_error" with no detail.
                                if not error_text:
                                    out_tokens = (sdk_event.usage or {}).get("output_tokens", 0)
                                    error_text = (
                                        "SDK turn ended with error but provided no "
                                        f"message (output_tokens={out_tokens}). "
                                        "Likely cause: hit per-turn output-token cap "
                                        "or transient API issue. The session is "
                                        "recoverable — send another message to continue."
                                    )
                                    logger.warning(
                                        "[%s] SDK is_error with empty result; "
                                        "usage=%s sdk_event=%r",
                                        task.bonsai_sid[:8], sdk_event.usage,
                                        sdk_event,
                                    )
                                await handler.on_event(RuntimeEvent(method="agent/error", params={
                                    **_turn_event,
                                    "subtype": "context_overflow" if is_context_overflow else "turn_error",
                                    "errors": [error_text],
                                    "result": error_text,
                                }))
                            elif interrupted:
                                # Interrupt path — emit interrupted, not turnComplete.
                                # Same client, same context — runner goes back to idle.
                                # Close any subagents left open (SubagentStop hook may
                                # not fire when the SDK is interrupted mid-turn).
                                await hooks.close_orphaned_subagents()
                                await handler.on_event(RuntimeEvent(method="agent/interrupted", params=_turn_event))
                            else:
                                await handler.on_event(RuntimeEvent(method="agent/turnComplete", params={
                                    **_turn_event,
                                    "result": sdk_event.result or "",
                                }))
                            tracker.set_status(task.bonsai_sid, "idle")
                            await handler.on_event(RuntimeEvent(method="agent/statusChanged", params={
                                "bonsaiSid": task.bonsai_sid,
                                "status": "idle",
                            }))
                            break  # back to conversation loop, same client
            finally:
                tracker.clear_client(task.bonsai_sid)

        # Session closed gracefully (END_SIGNAL received)
        duration_ms = int((time.monotonic() - start_time) * 1000)
        # Include outcome in the done payload so the frontend transitions
        # atomically — otherwise there's a race where status flips to "done"
        # before the separate session/didUpdate notification carrying the
        # outcome is processed, and the UI briefly shows a "session ended"
        # state with no next-step contract.
        outcome_payload = (
            task.outcome.model_dump(by_alias=True) if task.outcome is not None else None
        )
        await handler.on_event(RuntimeEvent(method="agent/done", params={
            "bonsaiSid": task.bonsai_sid,
            "sessionId": session_id,
            "result": "",
            "costUsd": total_cost,
            "turns": total_turns,
            "durationMs": duration_ms,
            "usage": {},
            "outcome": outcome_payload,
        }))

        return AgentResult(
            bonsai_sid=task.bonsai_sid,
            session_id=session_id,
            result="",
            cost_usd=total_cost,
            turns=total_turns,
            duration_ms=duration_ms,
        )

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None:
        """Interrupt the SDK turn for ``task``.

        ``AgentService.interrupt_task`` keeps ``set_interrupted`` and
        ``interrupt_futures`` (bonsai-internal state); this method only
        delivers the runtime-specific cancel — the existing ``interrupted``
        branch in ``run_session`` reacts to the resulting ``ResultMessage``.
        """
        client = tracker.get_client(task.bonsai_sid)
        if client is None:
            return
        try:
            await client.interrupt()
        except Exception:
            logger.debug("Claude client.interrupt() failed", exc_info=True)
