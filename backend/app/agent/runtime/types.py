"""Runtime contract types — IAgentRuntime, RuntimeType, RuntimeExecutionConfig."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from app.agent.models import AgentResult, AgentTask, to_camel

if TYPE_CHECKING:
    from app.agent.runtime.events import AgentEventHandler
    from app.agent.tracker import Tracker


RuntimeType = Literal["claude", "codex"]


class RuntimeExecutionConfig(BaseModel):
    """Runtime-internal execution config derived from AgentConfig + task context.

    Held separately from AgentConfig (the user-facing persisted config) because
    it carries fields that only make sense at execution time — working_directory,
    system_prompt, resume_session_id — and is the contract every IAgentRuntime
    consumes.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    working_directory: str
    model: str = "claude-sonnet-4-6"
    system_prompt: str | None = None
    resume_session_id: str | None = None
    betas: list[str] = Field(default_factory=list)
    effort: str | None = None
    max_turns: int = 50
    permission_mode: str = "default"
    stream_text: bool = True


@runtime_checkable
class IAgentRuntime(Protocol):
    """Runtime-agnostic agent contract.

    Each backend (Claude SDK today, Codex / others later) implements this
    protocol. The conversational loop stays inside ``run_session`` — there is
    no open/send/close split. Cancellation is callback-driven: ``interrupt``
    is invoked by ``AgentService.interrupt_task`` and the runtime decides what
    "interrupt the current turn" means; ``run_session`` exits naturally on
    the next loop iteration.
    """

    runtime_type: RuntimeType
    display_name: str

    async def run_session(
        self,
        task: AgentTask,
        exec_config: RuntimeExecutionConfig,
        handler: AgentEventHandler,
    ) -> AgentResult: ...

    async def interrupt(self, task: AgentTask, tracker: Tracker) -> None: ...
