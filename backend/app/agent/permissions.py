"""Tool permission routing for the agent runtime."""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from claude_agent_sdk import (
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)

from app.agent.models import AgentTask
from app.agent.runtime.permissions import (
    ToolCategory,
    ToolPermissionRequest,
    ToolPermissionResponse,
)
from app.agent.tools import INTERCEPTORS
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.core.settings import load_settings

logger = logging.getLogger(__name__)

# ── Tool categorization & permission-mode policy ───────────────────────

# Single source of truth for which built-in tool falls in which category.
# MCP tools fall back to per-interceptor classification below; unknown
# tools default to ``"edit"`` — fail-closed so a new tool that slips in
# without classification still requires user approval.
_TOOL_CATEGORIES: dict[str, ToolCategory] = {
    # read
    "Read": "read",
    "Glob": "read",
    "Grep": "read",
    "LS": "read",
    "NotebookRead": "read",
    # net
    "WebFetch": "net",
    "WebSearch": "net",
    # edit
    "Edit": "edit",
    "Write": "edit",
    "MultiEdit": "edit",
    "NotebookEdit": "edit",
    # bash
    "Bash": "bash",
    "BashOutput": "bash",
    "KillShell": "bash",
    # control-flow / meta tools — non-mutating, so classified as "read"
    # so they are allowed in plan mode. ``ExitPlanMode`` in particular
    # MUST be allowed in plan mode (it is the SDK's mechanism for
    # leaving plan mode); auto-denying it would make plan mode a
    # one-way trap. ``Agent`` (subagent dispatch) and ``TodoWrite``
    # (internal todo tracking) likewise do not modify the workspace —
    # any tool calls a subagent makes are checked individually.
    "ExitPlanMode": "read",
    "EnterPlanMode": "read",
    "Agent": "read",
    "TodoWrite": "read",
}

# Per-interceptor semantic categories for Bonsai's own MCP tools. Keyed
# by the same suffix used in ``INTERCEPTORS``. Without this map, every
# interceptor would fall back to the catch-all ``"mcp"`` bucket — which
# plan mode denies — but mutating tools like ``spec_delete`` would still
# slip past because the INTERCEPTORS dispatch short-circuits the mode
# filter. Pinning a precise category lets plan mode block mutating
# tools while still allowing read-only ones (spec_search, etc.).
#
# ``SuggestDescription`` is intentionally absent: its category depends
# on the ``apply`` flag in tool input (``edit`` when ``apply=true``,
# else ``read``). It is classified dynamically inside ``categorize``.
_INTERCEPTOR_CATEGORIES: dict[str, ToolCategory] = {
    # Read-only / display-only — safe in plan mode.
    "bonsai_visualize": "read",   # renders a card, no side effects
    "SuggestSession": "read",      # notifies frontend; user creates the session
    "spec_search": "read",
    "spec_links": "read",
    "suggest_step": "read",        # interactive proposal; user must approve
    # Mutating — must be denied in plan mode. ``spec_delete`` removes
    # spec files; ``ChangeTicketStatus`` flips ticket state. Neither
    # goes through a second permission gate inside their handler, so
    # the gate has to live here.
    "spec_delete": "edit",
    "ChangeTicketStatus": "edit",
}


def categorize(
    tool_name: str, input_data: dict[str, Any] | None = None,
) -> ToolCategory:
    """Classify a tool name into one of the five permission categories.

    Order: explicit ``_TOOL_CATEGORIES`` mapping → interceptor suffix
    match (``_INTERCEPTOR_CATEGORIES`` + dynamic special cases) →
    ``"mcp"`` for the catch-all ``mcp__`` prefix → fail-closed default
    of ``"edit"``.

    ``input_data`` enables input-aware classification for tools whose
    mutating-ness depends on arguments. Currently only
    ``SuggestDescription`` (``edit`` iff ``apply=true``, else ``read``).
    """
    if tool_name in _TOOL_CATEGORIES:
        return _TOOL_CATEGORIES[tool_name]
    # MCP tool names arrive fully-qualified (``mcp__server__suffix``),
    # so match by suffix the same way ``INTERCEPTORS`` dispatch does.
    if tool_name.endswith("SuggestDescription"):
        # Default flow sends an interactive card; only ``apply=true``
        # writes the ticket body. Without that flag, plan mode must
        # allow it through to the interceptor's interactive handler.
        if input_data and input_data.get("apply"):
            return "edit"
        return "read"
    for suffix, category in _INTERCEPTOR_CATEGORIES.items():
        if tool_name.endswith(suffix):
            return category
    if tool_name.startswith("mcp__"):
        return "mcp"
    return "edit"


# (mode, category) → decision. ``None`` means "no definitive answer —
# fall through to interceptors / interactive prompt". Mirrors the
# reference's ``permissionPolicyEngine.ts:192-246`` table.
_MODE_TABLE: dict[str, dict[ToolCategory, str | None]] = {
    "bypassPermissions": {
        "read": "allow", "net": "allow", "edit": "allow",
        "bash": "allow", "mcp": "allow",
    },
    "plan": {
        "read": "allow", "net": "allow", "edit": "deny",
        "bash": "deny", "mcp": "deny",
    },
    "acceptEdits": {
        "read": "allow", "net": "allow", "edit": "allow",
        "bash": None, "mcp": None,
    },
    "default": {
        "read": "allow", "net": "allow", "edit": None,
        "bash": None, "mcp": None,
    },
}

_PLAN_DENY_MESSAGE = (
    "Plan mode forbids tools that modify the workspace. Switch out of "
    "plan mode to run this tool."
)


def evaluate_mode(
    mode: str, category: ToolCategory,
) -> ToolPermissionResponse | None:
    """Resolve a tool call against the active permission mode.

    Returns a definitive ``ToolPermissionResponse`` when the
    ``(mode, category)`` cell is allow/deny, or ``None`` when the
    caller should fall through to interceptors / interactive prompt.
    """
    row = _MODE_TABLE.get(mode)
    if row is None:
        return None
    decision = row.get(category)
    if decision == "allow":
        return ToolPermissionResponse(behavior="allow")
    if decision == "deny":
        return ToolPermissionResponse(
            behavior="deny", message=_PLAN_DENY_MESSAGE,
        )
    return None


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
        # Store pending request so session/get can include it
        request_type = "approval" if method == "agent/confirmAction" else "question"
        tracker.set_pending_request(task.bonsai_sid, {
            "requestId": request_id,
            "type": request_type,
            **{k: v for k, v in params.items() if k != "bonsaiSid"},
        })
        await notify(method, {**params, "attempt": attempt}, request_id=request_id)
        response = await future

        if not response.get("timed_out"):
            # User answered (or explicitly denied) — restore running status
            tracker.clear_pending_request(task.bonsai_sid)
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
        tracker.clear_pending_request(task.bonsai_sid)
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
    request: ToolPermissionRequest,
    *,
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> ToolPermissionResponse:
    """Route tool permission requests to the appropriate handler.

    Runtime-neutral entrypoint: takes a ``ToolPermissionRequest`` and
    returns a ``ToolPermissionResponse``. Each ``IAgentRuntime``
    implementation is responsible for translating its native permission
    shape (Claude SDK, Codex sandbox, etc.) to/from these neutral
    models — see ``claude_can_use_tool_adapter`` (added in plan 01
    Task 6).

    Dispatch order:
    1. ConfirmStatement / AskUserQuestion — interactive transport
       primitives. They must reach their card flow regardless of
       permission mode (plan mode must still allow clarifying
       questions; acceptEdits must not auto-allow without populating
       ``answers``).
    2. Mode-category filter — enforces ``permission_mode`` against the
       tool's category. Runs before INTERCEPTORS so plan mode can
       deny mutating MCP tools (``spec_delete``, ``ChangeTicketStatus``,
       ``SuggestDescription``) that auto-approve in their interceptor.
    3. INTERCEPTORS — suffix-matched MCP tool interceptors. Real tool
       logic lives in their handlers via ``get_tool_context()``.
    4. Default — generic tool approval via ``agent/confirmAction``.
    """
    tool_name = request.tool_name
    input_data = request.input

    # Built-in: ConfirmStatement
    if tool_name == "ConfirmStatement":
        request_id = str(uuid4())
        future = tracker.register_future(task.bonsai_sid, request_id)
        await notify(
            "agent/confirmStatement",
            {"bonsaiSid": task.bonsai_sid, "statement": input_data.get("statement", "")},
            request_id=request_id,
        )
        response = await future
        if response.get("behavior") == "deny":
            return ToolPermissionResponse(
                behavior="deny",
                message=response.get("message", "Timed out"),
                interrupt=response.get("interrupt", False),
            )
        return ToolPermissionResponse(
            behavior="allow",
            updated_input={"statement": response.get("statement", input_data.get("statement", ""))},
        )

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
            return ToolPermissionResponse(
                behavior="deny",
                message="Timed out waiting for user response",
                interrupt=settings.user_respond_timeout_behavior != "deny",
            )
        if response.get("behavior") == "deny":
            return ToolPermissionResponse(
                behavior="deny",
                message=response.get("message", "Denied by user"),
                interrupt=response.get("interrupt", False),
            )
        return ToolPermissionResponse(
            behavior="allow",
            updated_input={
                "questions": response.get("questions", []),
                "answers": response.get("answers", {}),
            },
        )

    # Mode-based filtering — runs after interactive primitives so it
    # cannot suppress those flows, and BEFORE INTERCEPTORS so plan
    # mode can deny mutating MCP tools (interceptors auto-approve in
    # their fast path; without this gate, plan mode wouldn't reach
    # them). ``None`` falls through to interceptors / user-prompt.
    decision = evaluate_mode(
        request.permission_mode, categorize(tool_name, input_data),
    )
    if decision is not None:
        return decision

    # MCP tools: dispatch via INTERCEPTORS registry (suffix match)
    for suffix, intercept_fn in INTERCEPTORS.items():
        if tool_name.endswith(suffix):
            return await intercept_fn(input_data, tracker, notify, task, config)

    # Default: generic tool approval
    response, _request_id = await _await_user_response(
        tracker, notify, task, config,
        method="agent/confirmAction",
        params={
            "bonsaiSid": task.bonsai_sid,
            "toolName": tool_name,
            "toolInput": input_data,
            "toolUseId": request.tool_use_id,
        },
    )
    if response is None:
        # Timeout — interrupt or deny based on configured behavior
        settings = load_settings(config.project_root)
        return ToolPermissionResponse(
            behavior="deny",
            message="Timed out waiting for user response",
            interrupt=settings.user_respond_timeout_behavior != "deny",
        )
    if response.get("behavior") == "allow":
        return ToolPermissionResponse(behavior="allow")
    return ToolPermissionResponse(
        behavior="deny",
        message=response.get("message", "Denied by user"),
        interrupt=response.get("interrupt", False),
    )


async def claude_can_use_tool_adapter(
    tool_name: str,
    input_data: dict[str, Any],
    context: ToolPermissionContext,
    *,
    tool_use_id: str | None,
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow | PermissionResultDeny:
    """Bridge Claude SDK's ``canUseTool`` callback to ``can_use_tool``.

    This is the **only** place in the agent runtime that imports Claude
    SDK permission types. The runner installs this as its ``can_use_tool``
    callback (plan 01 Task 9); for every other runtime the engine is
    invoked directly with neutral types.
    """
    ctx_session_id = getattr(context, "session_id", None)
    if not isinstance(ctx_session_id, str):
        ctx_session_id = task.bonsai_sid
    req = ToolPermissionRequest(
        tool_name=tool_name,
        input=input_data,
        tool_use_id=tool_use_id,
        session_id=ctx_session_id,
        permission_mode=task.config.permission_mode or "default",
    )
    response = await can_use_tool(
        req, tracker=tracker, notify=notify, task=task, config=config,
    )
    if response.behavior == "allow":
        return PermissionResultAllow(
            behavior="allow",
            updated_input=response.updated_input,
        )
    return PermissionResultDeny(
        behavior="deny",
        message=response.message or "Denied",
        interrupt=response.interrupt,
    )
