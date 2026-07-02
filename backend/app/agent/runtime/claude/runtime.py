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
    SystemMessage,
    TextBlock,
    ToolPermissionContext,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from claude_agent_sdk.types import StreamEvent

from app.agent.models import AgentResult, AgentTask, TaskStatus, to_camel
from app.agent.permissions import claude_can_use_tool_adapter
from app.agent.pricing import TokenUsage, cost
from app.agent.subagents import SUBAGENT_TOOL_NAME, TICKET_STEP_EXECUTOR


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
from app.agent.runtime.claude.catalog import CatalogFlag, catalog_holder
from app.agent.runtime.claude.change_log_hook import ChangeLogHook
from app.agent.runtime.claude.hooks import SubagentHooks
from app.agent.runtime.claude.models import ClaudeModelRegistry
from app.agent.runtime.claude.skills import ClaudeSkillRegistry
from app.agent.runtime.events import RuntimeEvent
from app.agent.runtime.types import (
    LabeledOption,
    ModelCapability,
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


# Effort levels stay SDK-sourced — the picker can't list a value the runtime
# would reject. ``auto`` is ThinkRail's neutral "no explicit effort".
_CLAUDE_EFFORT_LEVELS: tuple[LabeledOption, ...] = (
    LabeledOption(value="auto", label="auto"),
    *(LabeledOption(value=v, label=v) for v in get_args(EffortLevel)),
)
_SDK_EFFORTS: frozenset[str] = frozenset(get_args(EffortLevel))


def _permission_mode_options() -> tuple[LabeledOption, ...]:
    """Permission modes: the SDK's own value set (anti-drift), minus modes the
    catalog marks hidden, labelled/described from the catalog overlay. An
    unmapped SDK mode falls back to its raw value as the label."""
    overlay = catalog_holder.current.permission_modes
    out: list[LabeledOption] = []
    for value in get_args(PermissionMode):
        entry = overlay.get(value)
        if entry is not None and entry.hidden:
            continue
        label = entry.label if (entry and entry.label) else value
        description = entry.description if entry else ""
        out.append(LabeledOption(value=value, label=label, description=description))
    return tuple(out)


def _claude_flags() -> tuple[RuntimeFlag, ...]:
    """Runtime option toggles, from the catalog (currently just ``context1m``)."""
    return tuple(
        RuntimeFlag(key=f.key, label=f.label, type=f.type, default=f.default,
                    description=f.description)
        for f in catalog_holder.current.flags
    )


def _context_1m_flag() -> CatalogFlag | None:
    """The 1M-context flag definition from the catalog, if present."""
    for f in catalog_holder.current.flags:
        if f.beta is not None:
            return f
    return None


def _effective_effort(
    models: ClaudeModelRegistry, model: str, effort: str | None
) -> str | None:
    """Effort to hand the SDK for ``model``. Translates ``"auto"`` to ``None``
    and clamps any effort the model doesn't accept back to ``None`` — an unsound
    combination (e.g. Haiku + ``xhigh``) can never reach the SDK."""
    if not effort or effort == "auto":
        return None
    if effort in models.supported_efforts(model):
        return effort
    return None


def _wants_1m_beta(
    models: ClaudeModelRegistry, model: str, flags: dict[str, bool]
) -> bool:
    """Request the 1M beta when the flag is on (default) and the model supports
    1M. Returns False if the catalog declares no 1M flag."""
    flag = _context_1m_flag()
    if flag is None:
        return False
    return bool(flags.get(flag.key, flag.default)) and models.supports_1m(model)


def _context_1m_beta_for(
    models: ClaudeModelRegistry, model: str, flags: dict[str, bool]
) -> str | None:
    """The 1M beta header to send, or None. The flag's key, default, and beta
    string are all catalog-driven; the model must actually support 1M."""
    flag = _context_1m_flag()
    if flag is None or flag.beta is None:
        return None
    enabled = bool(flags.get(flag.key, flag.default))
    return flag.beta if (enabled and models.supports_1m(model)) else None


class ClaudeRuntime:
    """Claude Agent SDK runtime — implements ``IAgentRuntime``.

    The conversational loop is owned by ``run_session``. Per-session state
    (tracker queue, MCP tool context, subagent correlation maps) is reset
    each call; runtime-level dependencies (tracker, plugin dir, model
    registry, spec service, coordinator, agent service) come in via ``__init__`` so that
    ``AgentService`` can construct one ``ClaudeRuntime`` per service
    lifetime and re-use it for every session.
    """

    runtime_type: RuntimeType = "claude"
    display_name: str = "Claude Code"
    guidance_file: str | None = "CLAUDE.md"
    init_command: str | None = "claude init"
    # Starter content written when the user clicks "Init agent" from
    # onboarding. The real ``claude init`` analyses the repo and fills
    # this in — the template just bootstraps the file so the agent has
    # somewhere to write to and points the user at the proper command.
    guidance_template: str | None = (
        "# Project context for Claude Code\n"
        "\n"
        "<!--\n"
        "  This file was bootstrapped by ThinkRail. Run `claude init` (or open\n"
        "  Claude Code and use the `/init` slash command) to have Claude\n"
        "  analyse this repository and populate the sections below.\n"
        "-->\n"
        "\n"
        "## Overview\n"
        "\n"
        "<what this project is, in one paragraph>\n"
        "\n"
        "## Stack\n"
        "\n"
        "<languages, frameworks, key dependencies>\n"
        "\n"
        "## How to run\n"
        "\n"
        "<commands to start the project>\n"
        "\n"
        "## Conventions\n"
        "\n"
        "<naming, layout, tests, anything an agent should respect>\n"
    )

    def __init__(
        self,
        *,
        app_config: AppConfig,
        tracker: Tracker | None = None,
        plugin_dir: Path | None = None,
        spec_service: Any = None,
        coordinator: Any = None,
        agent_service: Any = None,
    ) -> None:
        self.tracker = tracker
        self.app_config = app_config
        self.plugin_dir = plugin_dir
        self.spec_service = spec_service
        self.coordinator = coordinator
        self.agent_service = agent_service
        # The Claude runtime owns its own model + skill registries.
        # ``IAgentRuntime`` exposes only the public surface
        # (``capabilities``, ``list_skills`` etc.); the registry instances
        # are private to this class.
        self._models = ClaudeModelRegistry()
        self._skills = ClaudeSkillRegistry(project_root=app_config.project_root)

    # ── IAgentRuntime: capability surface ────────────────────────────────

    def capabilities(self) -> RuntimeCapabilities:
        models = self._models.list_options()
        return RuntimeCapabilities(
            permission_modes=list(_permission_mode_options()),
            effort_levels=list(_CLAUDE_EFFORT_LEVELS),
            models=models,
            flags=list(_claude_flags()),
            model_capabilities=[self._model_capability(o.value) for o in models],
        )

    def _model_capability(self, model: str) -> ModelCapability:
        """Per-model allowlist of effort values (``auto`` always first) and
        flag keys, for the picker to filter against."""
        efforts = [e for e in self._models.supported_efforts(model) if e in _SDK_EFFORTS]
        flag = _context_1m_flag()
        flags = [flag.key] if (flag is not None and self._models.supports_1m(model)) else []
        return ModelCapability(model=model, effort_levels=["auto", *efforts], flags=flags)

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
        rates = self._models.rates_for(task.config.model)

        # Subagent lifecycle hooks — owns the parent_tool_use_id ↔ agent_id
        # correlation map and emits SubagentStart/Stop/PreCompact events.
        # The runtime updates ``hooks.session_id`` after SDK init and
        # ``hooks.iterations`` at the start of each turn.
        hooks = SubagentHooks(task, handler)
        change_hook = ChangeLogHook(task, config)

        plugins = []
        if plugin_dir and Path(plugin_dir).is_dir():
            plugins.append({"type": "local", "path": str(plugin_dir)})

        # Set tool context BEFORE SDK client creation so that MCP tool handlers
        # can access session state (tracker, notify, task, config) via
        # get_tool_context().  This is critical for yolo mode where the CLI
        # bypasses canUseTool and invokes MCP tools directly.
        set_tool_context(
            tracker, notify, task, config,
            spec_service=self.spec_service,
            coordinator=self.coordinator,
            agent_service=self.agent_service,
        )

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
        # ticket-implement in subagent mode (step-session mode drives steps via
        # suggest_step instead and needs no subagent).
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
            # 1M beta and effort are both clamped to what the model supports —
            # an unsound combination (e.g. Haiku + xhigh / 1M) never reaches the
            # SDK even if a stale or hand-edited config carries one.
            betas=(
                [beta] if (beta := _context_1m_beta_for(self._models, task.config.model, task.config.flags))
                else []
            ),
            effort=_effective_effort(self._models, task.config.model, task.config.effort),
            max_buffer_size=10 * 1024 * 1024,  # 10MB — default 1MB is too small for large tool results
            extra_args={"allow-dangerously-skip-permissions": None},  # enable mid-session mode switching to bypassPermissions
            hooks={
                "SubagentStart": [HookMatcher(hooks=[hooks.start_hook])],
                "SubagentStop": [HookMatcher(hooks=[hooks.stop_hook])],
                "PreCompact": [HookMatcher(hooks=[hooks.pre_compact_hook])],
                "PostToolUse": [HookMatcher(hooks=[change_hook.post_tool_use])],
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
            logger.info("[%s] SDK client ready in %dms", task.thinkrail_sid[:8], sdk_init_ms)
            tracker.set_client(task.thinkrail_sid, client)
            tracker.set_status(task.thinkrail_sid, TaskStatus.IDLE)
            await handler.on_event(RuntimeEvent(method="agent/ready", params={
                "thinkrailSid": task.thinkrail_sid,
            }))
            # Track tool calls that change permission mode (ExitPlanMode, EnterPlanMode)
            # so we can notify the frontend when the SDK changes mode internally.
            _mode_change_tools: dict[str, str] = {}  # tool_use_id → new permission_mode
            try:
                # -- conversation loop --
                while True:
                    message = await tracker.get_next_message(task.thinkrail_sid)

                    if message is END_SIGNAL:
                        break

                    tracker.set_status(task.thinkrail_sid, TaskStatus.RUNNING)
                    await handler.on_event(RuntimeEvent(method="agent/statusChanged", params={
                        "thinkrailSid": task.thinkrail_sid,
                        "status": TaskStatus.RUNNING,
                    }))
                    tracker.clear_turn_text(task.thinkrail_sid)
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
                                task.thinkrail_sid[:8], exc_info=True,
                            )

                    await client.query(message)

                    async for sdk_event in client.receive_response():
                        if isinstance(sdk_event, SystemMessage) and sdk_event.subtype == "init":
                            new_sid = sdk_event.data.get("session_id", "")
                            first_init = not session_id
                            session_id = new_sid
                            hooks.session_id = session_id
                            tracker.set_session_id(task.thinkrail_sid, session_id)
                            if first_init:
                                sdk_data = {to_camel(k): v for k, v in sdk_event.data.items()}
                                await handler.on_event(RuntimeEvent(method="agent/sessionStart", params={
                                    "thinkrailSid": task.thinkrail_sid,
                                    "sessionId": session_id,
                                    "systemPrompt": spec_context,
                                    **sdk_data,
                                }))

                        elif isinstance(sdk_event, AssistantMessage):
                            agent_id = hooks.resolve_agent_id(sdk_event.parent_tool_use_id)
                            for block in sdk_event.content:
                                if isinstance(block, TextBlock):
                                    tracker.append_turn_text(task.thinkrail_sid, block.text)
                                    await handler.on_event(RuntimeEvent(
                                        method="agent/textDelta",
                                        params=build_text_delta_params(
                                            thinkrail_sid=task.thinkrail_sid,
                                            session_id=session_id,
                                            text=block.text,
                                            agent_id=agent_id,
                                        ),
                                    ))
                                elif isinstance(block, ToolUseBlock):
                                    # Track subagent-dispatch tool calls so we can
                                    # correlate them with SubagentStart hooks.
                                    if block.name == SUBAGENT_TOOL_NAME:
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
                                            thinkrail_sid=task.thinkrail_sid,
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
                                                "thinkrailSid": task.thinkrail_sid,
                                                "model": task.config.model,
                                                "permissionMode": new_mode,
                                                "effort": task.config.effort,
                                            }))
                                        await handler.on_event(RuntimeEvent(
                                            method="agent/toolCallEnd",
                                            params=build_tool_call_end_params(
                                                thinkrail_sid=task.thinkrail_sid,
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
                                est = cost(TokenUsage(
                                    input_tokens=turn_input,
                                    output_tokens=turn_output,
                                    cache_read_tokens=turn_cache_read,
                                    cache_write_5m_tokens=turn_cache_write_5m,
                                    cache_write_1h_tokens=turn_cache_write_1h,
                                ), rates)
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
                                    "thinkrailSid": task.thinkrail_sid,
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
                                        task.thinkrail_sid[:8], turn_ms, sdk_event.total_cost_usd or 0.0)
                            turn_cost = cost(TokenUsage(
                                input_tokens=turn_input,
                                output_tokens=turn_output,
                                cache_read_tokens=turn_cache_read,
                                cache_write_5m_tokens=turn_cache_write_5m,
                                cache_write_1h_tokens=turn_cache_write_1h,
                            ), rates)
                            logger.debug(
                                "[%s] cost detail: sdk=$%.4f computed=$%.4f "
                                "in=%d out=%d cw5m=%d cw1h=%d cr=%d turns=%d",
                                task.thinkrail_sid[:8],
                                sdk_event.total_cost_usd or 0.0, turn_cost,
                                turn_input, turn_output,
                                turn_cache_write_5m, turn_cache_write_1h, turn_cache_read,
                                sdk_event.num_turns or 0,
                            )
                            # SDK total_cost_usd is per-turn and auth-gated (often 0
                            # under managed auth); we price tokens ourselves.
                            total_cost += turn_cost
                            # num_turns is per-turn — accumulate
                            turn_turns = sdk_event.num_turns or 0
                            total_turns += turn_turns
                            duration_ms = int((time.monotonic() - start_time) * 1000)

                            # Check if this ResultMessage came from an interrupt
                            interrupted = tracker.is_interrupted(task.thinkrail_sid)
                            if interrupted:
                                tracker.clear_interrupted(task.thinkrail_sid)

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
                                "thinkrailSid": task.thinkrail_sid,
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
                                        task.thinkrail_sid[:8], sdk_event.usage,
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
                            tracker.set_status(task.thinkrail_sid, TaskStatus.IDLE)
                            await handler.on_event(RuntimeEvent(method="agent/statusChanged", params={
                                "thinkrailSid": task.thinkrail_sid,
                                "status": TaskStatus.IDLE,
                            }))
                            break  # back to conversation loop, same client
            finally:
                tracker.clear_client(task.thinkrail_sid)

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
            "thinkrailSid": task.thinkrail_sid,
            "sessionId": session_id,
            "result": "",
            "costUsd": total_cost,
            "turns": total_turns,
            "durationMs": duration_ms,
            "usage": {},
            "outcome": outcome_payload,
        }))

        return AgentResult(
            thinkrail_sid=task.thinkrail_sid,
            session_id=session_id,
            result="",
            cost_usd=total_cost,
            turns=total_turns,
            duration_ms=duration_ms,
        )

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None:
        """Interrupt the SDK turn for ``task``.

        ``AgentService.interrupt_task`` keeps ``set_interrupted`` and
        ``interrupt_futures`` (thinkrail-internal state); this method only
        delivers the runtime-specific cancel — the existing ``interrupted``
        branch in ``run_session`` reacts to the resulting ``ResultMessage``.
        """
        client = tracker.get_client(task.thinkrail_sid)
        if client is None:
            return
        try:
            await client.interrupt()
        except Exception:
            logger.debug("Claude client.interrupt() failed", exc_info=True)
