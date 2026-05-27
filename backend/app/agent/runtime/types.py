"""Runtime contract types — IAgentRuntime, RuntimeType, RuntimeExecutionConfig, ModelInfo, RuntimeSkillInfo."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict

# ``RuntimeType`` is defined in ``app.agent.models`` (the definitional site) so
# ``AgentConfig`` can embed it without a circular import. Re-exported here for
# consumers that already use ``from app.agent.runtime import RuntimeType``.
from app.agent.models import AgentResult, AgentTask, RuntimeType, to_camel

if TYPE_CHECKING:
    from app.agent.runtime.events import AgentEventHandler
    from app.agent.tracker import Tracker


# Neutral floor used when a model id is not recognised by any runtime.
# Lives here (not in a Claude module) so services can reference it without
# importing provider-specific code.
DEFAULT_CONTEXT_WINDOW = 200_000


class ModelInfo(BaseModel):
    """Neutral model descriptor returned by ``IAgentRuntime.list_models``.

    Each runtime answers its own list.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    id: str
    label: str
    context_window: int


class RuntimeSkillInfo(BaseModel):
    """Skill exposed by a runtime, surfaced as an autocomplete suggestion.

    Each runtime answers its own list via ``IAgentRuntime.list_skills``.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    id: str  # e.g. "review", "specdriven:ticket-specify"
    name: str  # human-readable name (defaults to id)
    description: str  # short one-liner
    source: str  # "user" | "project" | "plugin" | "command" | "builtin"


class RuntimeExecutionConfig(BaseModel):
    """Runtime-internal execution config derived from AgentConfig + task context.

    Held separately from AgentConfig (the user-facing persisted config) because
    it carries fields that only make sense at execution time — working_directory,
    system_prompt, resume_session_id — and is the contract every IAgentRuntime
    consumes.

    Neutral by design: each runtime translates these to its own SDK shape.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    working_directory: str
    # ``model`` is required: this type is runtime-neutral and the caller (one
    # of the runtimes) is the only party that knows which model id matches.
    model: str
    system_prompt: str | None = None
    resume_session_id: str | None = None
    effort: str | None = None
    permission_mode: str = "default"
    stream_text: bool = True


@runtime_checkable
class IAgentRuntime(Protocol):
    """Runtime-agnostic agent contract.

    A runtime is the declaration that "this kind of agent is supported": it
    answers what models it provides and how to run a session against one.
    Implementations should be effectively stateless from the protocol's
    perspective — any per-runtime caches (model lists, skills) are an
    internal concern. There is no startup/shutdown handshake; the registry
    simply holds the instance.

    Cancellation is callback-driven: ``interrupt`` is invoked by
    ``AgentService.interrupt_task`` and the runtime decides what "interrupt
    the current turn" means; ``run_session`` exits naturally on the next
    loop iteration.
    """

    runtime_type: RuntimeType
    display_name: str

    def list_models(self) -> list[ModelInfo]:
        """Return the runtime's current best view of its available models.

        Whether the list is static, periodically refreshed, lazily fetched
        on first call, or sourced from a remote registry is entirely the
        runtime's business — callers don't see refresh semantics or
        freshness metadata.
        """
        ...

    def list_skills(self) -> list[RuntimeSkillInfo]:
        """Return the runtime's current best view of its available skills.

        Whether the list is static, periodically refreshed, lazily fetched
        on first call, or sourced from on-disk roots is entirely the
        runtime's business — callers don't see refresh semantics or
        freshness metadata. Runtimes with no skill surface return ``[]``.
        """
        ...

    def get_context_window(self, model_id: str) -> int:
        """Return the context-window size for ``model_id`` in this runtime.

        Each runtime owns the lookup, including any fallback for ids that
        aren't in the live list. Services use ``runtime.get_context_window``
        instead of scanning model metadata themselves.
        """
        ...

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult: ...

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None: ...
