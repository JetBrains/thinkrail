"""Runtime contract types — IAgentRuntime, RuntimeType, RuntimeExecutionConfig, capability types, RuntimeSkillInfo."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ``RuntimeType`` is defined in ``app.agent.models`` (the definitional site) so
# ``SessionConfig`` can embed it without a circular import. Re-exported here for
# consumers that already use ``from app.agent.runtime import RuntimeType``.
from app.agent.models import AgentResult, AgentTask, RuntimeType, to_camel

if TYPE_CHECKING:
    from app.agent.runtime.events import AgentEventHandler
    from app.agent.tracker import Tracker


class LabeledOption(BaseModel):
    """A value the backend accepts, plus a display label for the UI.

    Used uniformly for permission modes, effort levels, and models on
    ``RuntimeCapabilities``. ``extra="forbid"`` surfaces typos at parse time.
    ``description`` is optional one-line prose for a hover tooltip; empty when
    the option needs no explanation (effort levels, models).
    """

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    value: str
    label: str
    description: str = ""


class RuntimeFlag(BaseModel):
    """A runtime-declared option toggle, surfaced as a control in settings.

    Each runtime advertises its own flags; the frontend renders one control
    per flag and stores the chosen value in ``SessionConfig.flags`` keyed by
    ``key``. ``type`` is a discriminator (only ``"boolean"`` today) so other
    value kinds can be added without changing the shape.
    """

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    key: str
    label: str
    type: Literal["boolean"]
    default: bool
    description: str = ""


class ModelCapability(BaseModel):
    """Per-model subset of the runtime's tunable options.

    ``effort_levels`` and ``flags`` are *value*/​*key* allowlists scoped to one
    model — subsets of the runtime-wide ``RuntimeCapabilities.effort_levels`` /
    ``flags`` (which carry the display labels). The UI uses these to show only
    the efforts and flags the selected model actually accepts; the backend
    clamps unsound combinations at the runtime boundary regardless.
    """

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    model: str
    effort_levels: list[str]
    flags: list[str] = Field(default_factory=list)


class RuntimeCapabilities(BaseModel):
    """What a runtime accepts for the user-tunable fields.

    Order is contract: position 0 of ``permission_modes`` / ``effort_levels`` /
    ``models`` is the runtime's default (cold-start picks ``[0].value``).

    ``effort_levels``/``models``/``flags`` are the runtime-wide menus (with
    labels). ``model_capabilities`` narrows them per model — a model with no
    entry is unconstrained (the UI shows every option). This lets the picker
    reflect that, say, Haiku accepts no effort level and no 1M context window.
    """

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    permission_modes: list[LabeledOption]
    effort_levels: list[LabeledOption]
    models: list[LabeledOption]
    flags: list[RuntimeFlag] = Field(default_factory=list)
    model_capabilities: list[ModelCapability] = Field(default_factory=list)

    @field_validator("permission_modes", "effort_levels", "models")
    @classmethod
    def _reject_empty(cls, v: list[LabeledOption]) -> list[LabeledOption]:
        if not v:
            raise ValueError("must declare at least one option")
        return v


class RuntimeIdentity(BaseModel):
    """Lightweight ``{runtimeType, displayName}`` pair for ``runtimes/list``."""

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    runtime_type: RuntimeType
    display_name: str


class RuntimeSkillInfo(BaseModel):
    """Skill exposed by a runtime, surfaced as an autocomplete suggestion.

    Each runtime answers its own list via ``IAgentRuntime.list_skills``.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)

    id: str  # e.g. "review", "thinkrail:ticket-specify"
    name: str  # human-readable name (defaults to id)
    description: str  # short one-liner
    source: str  # "user" | "project" | "plugin" | "command" | "builtin"


class RuntimeExecutionConfig(BaseModel):
    """Runtime-internal execution config derived from SessionConfig + task context.

    Held separately from SessionConfig (the user-facing persisted config) because
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
    declares its capabilities (models, permission modes, effort levels) via a
    single ``capabilities()`` method and runs sessions against them.
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

    # Engine-specific onboarding metadata. Each runtime declares the
    # repo-root file it expects to read for project context (e.g.
    # ``CLAUDE.md`` for Claude Code, ``AGENTS.md`` for Codex), the
    # shell command that refreshes it, and a starter template the UI
    # writes when the user clicks "Init agent" from the onboarding
    # screen. ``None`` means the runtime opts out of that capability.
    guidance_file: str | None
    init_command: str | None
    guidance_template: str | None

    def capabilities(self) -> RuntimeCapabilities:
        """Return what this runtime accepts for the user-tunable fields.

        Whether the model list inside is static, periodically refreshed,
        lazily fetched on first call, or sourced from a remote registry is
        entirely the runtime's business — callers don't see refresh
        semantics or freshness metadata. Order is contract: position 0 of
        each list is the runtime's default.
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

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult: ...

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None: ...
