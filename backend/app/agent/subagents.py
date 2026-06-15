"""Subagent definitions for the ticket-implement orchestrator.

When ``ticket-implement`` runs with ``task.subagent_mode == "subagent"``, the
runtime registers the agents below via ``ClaudeAgentOptions.agents`` so the
orchestrator can invoke them through the SDK's ``Task`` tool.

See ``.tr/design_docs/TICKET_LIFECYCLE_DESIGN.md`` §
*Implementation orchestration modes* for the full design.
"""

from __future__ import annotations

import re
from typing import Any

from claude_agent_sdk import AgentDefinition

# The subagent's tool set mirrors what today's step session can do, minus the
# orchestration tool the orchestrator alone owns:
#   * ``suggest_step`` — only the orchestrator proposes new plan steps.
_STEP_EXECUTOR_TOOLS: list[str] = [
    # SDK built-ins
    "Read",
    "Write",
    "Edit",
    "Grep",
    "Glob",
    "Bash",
    # ThinkRail MCP tools (registered names)
    "ProposeChange",
    "SetPreviewFile",
    "ClearPreviewFile",
    "LabelArtifact",
]


TICKET_STEP_EXECUTOR = AgentDefinition(
    description=(
        "Execute one plan step for a ThinkRail ticket. Reads relevant specs and "
        "source, edits files via ProposeChange, returns a one-paragraph summary."
    ),
    tools=_STEP_EXECUTOR_TOOLS,
    prompt=(
        "You are executing one plan step for a ThinkRail ticket. "
        "Read the referenced specs and source files, do the work, "
        "propose every file edit via ProposeChange (never Write/Edit "
        "specs directly), and return a one-paragraph summary of what "
        "you changed.\n\n"
        "Do not call suggest_step — that is the orchestrator's "
        "responsibility. If you cannot complete the step "
        "(missing context, blocked dependency, contradiction with another "
        "spec), return a one-paragraph explanation of the blocker."
    ),
)


# ── Step-prompt marker ───────────────────────────────────────────────────────
# The orchestrator prefixes every Task prompt with a self-identifying line so
# the persistence interceptor can link the resulting Task tool block back to
# the plan step. Example:
#
#     [thinkrail-step ticket=mt_abc12 step=5]
#     <step description>
#
# The marker has both ticket id and step number so out-of-order events or
# stale matches across different tickets can be detected.

_MARKER_RE = re.compile(
    r"^\[thinkrail-step\s+ticket=(?P<ticket>[^\s\]]+)\s+step=(?P<step>\d+)\]",
)


def parse_thinkrail_step_marker(prompt: str) -> dict[str, Any] | None:
    """Parse the leading ``[thinkrail-step …]`` marker on a Task prompt.

    Returns ``{"ticket_id": str, "step": int}`` on success, ``None`` if the
    prompt has no marker or the marker is malformed (missing ticket or step).
    """
    if not prompt:
        return None
    m = _MARKER_RE.match(prompt.lstrip("\n").strip())
    if not m:
        return None
    return {"ticket_id": m.group("ticket"), "step": int(m.group("step"))}


# ── Node-prompt marker ───────────────────────────────────────────────────────

_NODE_MARKER_RE = re.compile(
    r"^\[thinkrail-node\s+ticket=(?P<ticket>[^\s\]]+)\s+node=(?P<node>[^\s\]]+)\]",
)


def parse_thinkrail_node_marker(prompt: str) -> dict[str, Any] | None:
    """Parse the leading ``[thinkrail-node …]`` marker on a Task prompt.

    Returns ``{"ticket_id": str, "node": str}`` or ``None``.
    """
    if not prompt:
        return None
    m = _NODE_MARKER_RE.match(prompt.lstrip("\n").strip())
    if not m:
        return None
    return {"ticket_id": m.group("ticket"), "node": m.group("node")}
