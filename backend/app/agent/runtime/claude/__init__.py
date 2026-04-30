"""Claude SDK runtime — concrete `IAgentRuntime` implementation.

This package wraps the Claude Agent SDK conversational loop behind the
runtime-agnostic contract defined in :mod:`app.agent.runtime`. Subagent /
PreCompact hook plumbing lives in :mod:`hooks`; the loop itself lives in
:mod:`runtime`.
"""

from __future__ import annotations

from app.agent.runtime.claude.runtime import ClaudeRuntime

__all__ = ["ClaudeRuntime"]
