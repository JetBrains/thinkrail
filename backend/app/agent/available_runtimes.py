"""Single source of truth for the agent engines bonsai supports.

Listing engine classes here means adding a new backend (e.g. Codex) is
a one-line change. Onboarding code reads static engine metadata
(``guidance_file``, ``init_command``, ``display_name``) via class
attributes — no instantiation, no per-engine ``if`` branches at the
call site.

Lives at the ``agent`` package level (not under ``runtime/``) because
``runtime/`` is the neutral contract layer and must not import provider
SDKs; this catalog is a wiring concern that does. Live
``IAgentRuntime`` instances are still built per ``ProjectContext`` and
held by ``RuntimeRegistry`` — this module only enumerates the classes.
"""

from __future__ import annotations

from app.agent.runtime.claude.runtime import ClaudeRuntime
from app.agent.runtime.types import IAgentRuntime

AVAILABLE_RUNTIME_CLASSES: tuple[type[IAgentRuntime], ...] = (ClaudeRuntime,)
