"""Event-shape builders for the Claude runtime.

The Claude runtime constructs `RuntimeEvent` params dictionaries inline
in `runtime.run_session`. The shape of those params is the **wire
contract** that the frontend and persistence layer consume — any runtime
must produce structurally identical payloads for the same logical event
so the UI can render them without runtime-aware branches.

This module exposes pure functions that build those param dicts. They
take explicit inputs (no SDK types in the function signature) so another
runtime can reuse them — or treat them as a *contract reference* — to
keep its output aligned.

Keep these functions stateless. Per-session state (subagent correlation,
mode-change tracking, cost iteration aggregation) lives in
`runtime.py`; this module only owns the shape.
"""

from __future__ import annotations

from typing import Any


def build_tool_call_start_params(
    *,
    thinkrail_sid: str,
    session_id: str,
    tool_use_id: str,
    tool_name: str,
    tool_input: dict[str, Any] | Any,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Build params for an ``agent/toolCallStart`` runtime event.

    The caller is responsible for any per-tool input enrichment
    (e.g. ``_previousContent`` injection for ``Write``) before passing
    the input dict in. This keeps the function pure.
    """
    params: dict[str, Any] = {
        "thinkrailSid": thinkrail_sid,
        "sessionId": session_id,
        "toolUseId": tool_use_id,
        "toolName": tool_name,
        "toolInput": tool_input,
    }
    if agent_id:
        params["agentId"] = agent_id
    return params


def build_tool_call_end_params(
    *,
    thinkrail_sid: str,
    session_id: str,
    tool_use_id: str,
    output: str,
    is_error: bool,
    agent_id: str | None = None,
    tool_name: str = "",
) -> dict[str, Any]:
    """Build params for an ``agent/toolCallEnd`` runtime event.

    ``tool_name`` defaults to ``""`` because Claude's
    ``ToolResultBlock`` does not carry the tool name (it's keyed by
    ``tool_use_id`` only). The frontend resolves tool name from its
    matching ``toolCallStart`` event. A runtime that does carry the name
    on its result may pass it through; the wire shape stays consistent.
    """
    params: dict[str, Any] = {
        "thinkrailSid": thinkrail_sid,
        "sessionId": session_id,
        "toolUseId": tool_use_id,
        "toolName": tool_name,
        "output": output,
        "isError": is_error,
    }
    if agent_id:
        params["agentId"] = agent_id
    return params


def build_text_delta_params(
    *,
    thinkrail_sid: str,
    session_id: str,
    text: str,
    agent_id: str | None = None,
) -> dict[str, Any]:
    """Build params for an ``agent/textDelta`` runtime event."""
    params: dict[str, Any] = {
        "thinkrailSid": thinkrail_sid,
        "sessionId": session_id,
        "text": text,
    }
    if agent_id:
        params["agentId"] = agent_id
    return params
