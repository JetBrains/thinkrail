"""Subagent definitions for the ticket-implement orchestrator.

When ``ticket-implement`` runs with ``task.subagent_mode == "subagent"``, the
runtime registers the agents below via ``ClaudeAgentOptions.agents`` so the
orchestrator can invoke them through the SDK's ``Agent`` tool.

See the ``ticket-implement`` skill (``claude-plugin/skills/ticket-implement``)
and ``AgentService._render_orchestration_mode_section`` for how the orchestrator
drives plan steps in each mode.
"""

from __future__ import annotations

import re
from typing import Any

from claude_agent_sdk import AgentDefinition

# Name of the SDK tool that dispatches a subagent. The runtime correlates its
# tool-use blocks with SubagentStart hooks, and the persistence layer links its
# ``[thinkrail-step …]`` markers to plan steps — both must key off this exact
# name (older builds called it ``Task``).
SUBAGENT_TOOL_NAME = "Agent"

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
    "SetPreviewFile",
    "ClearPreviewFile",
    "LabelArtifact",
]


TICKET_STEP_EXECUTOR = AgentDefinition(
    description=(
        "Execute one plan step for a ThinkRail ticket. Reads relevant specs and "
        "source, edits files via Edit, returns a one-paragraph summary."
    ),
    tools=_STEP_EXECUTOR_TOOLS,
    prompt=(
        "You are executing one plan step for a ThinkRail ticket. "
        "Read the referenced specs and source files, do the work, "
        "edit files directly with Edit/Write, and return a one-paragraph "
        "summary of what you changed.\n\n"
        "Do not call suggest_step — that is the orchestrator's "
        "responsibility. If you cannot complete the step "
        "(missing context, blocked dependency, contradiction with another "
        "spec), return a one-paragraph explanation of the blocker."
    ),
)


# ── Step-prompt marker ───────────────────────────────────────────────────────
# The orchestrator prefixes every Agent prompt with a self-identifying line so
# the persistence interceptor can link the resulting Agent tool block back to
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
    """Parse the leading ``[thinkrail-step …]`` marker on an Agent prompt.

    Returns ``{"ticket_id": str, "step": int}`` on success, ``None`` if the
    prompt has no marker or the marker is malformed (missing ticket or step).
    """
    if not prompt:
        return None
    m = _MARKER_RE.match(prompt.lstrip("\n").strip())
    if not m:
        return None
    return {"ticket_id": m.group("ticket"), "step": int(m.group("step"))}
