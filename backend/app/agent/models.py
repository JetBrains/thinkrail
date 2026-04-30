from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Annotated, Any, Literal, Union
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def to_camel(name: str) -> str:
    """Convert snake_case to camelCase for JSON serialization."""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

TaskStatus = Literal["draft", "initializing", "idle", "running", "waiting", "done", "error"]


class SubsessionType(str, Enum):
    """Type of subsession — determines return flow behavior."""

    discussion = "discussion"
    refinement = "refinement"


# ─── Interaction request/response models ──────────────────────────────────────

class AgentConfig(BaseModel):
    """Run configuration passed to the Claude Agent SDK."""

    model_config = _CAMEL_CONFIG

    model: str = "claude-sonnet-4-6"
    max_turns: int = 50
    permission_mode: str = "default"
    stream_text: bool = True
    betas: list[str] = Field(default_factory=list)
    effort: str | None = None


class QuestionOption(BaseModel):
    """A selectable option within a question."""

    label: str
    description: str


class Question(BaseModel):
    """A single question with selectable options."""

    model_config = _CAMEL_CONFIG

    question: str
    header: str
    options: list[QuestionOption]
    multi_select: bool = False


class AskUserQuestionResponse(BaseModel):
    """Response to a question request from the frontend."""

    questions: list[Question]
    answers: dict[str, str]


class ToolApprovalResponse(BaseModel):
    """Response to a tool approval request from the frontend."""

    behavior: Literal["allow", "deny"]
    message: str | None = None
    interrupt: bool = False


# ─── Event payload models ──────────────────────────────────────────────────────

class SessionStartPayload(BaseModel):
    """Emitted once when the SDK session initializes."""

    model_config = ConfigDict(extra="allow", alias_generator=to_camel, populate_by_name=True)

    session_id: str = ""
    system_prompt: str = ""
    inference_budget_tokens: int | None = None


class TextDeltaPayload(BaseModel):
    """A chunk of streamed assistant text."""

    model_config = _CAMEL_CONFIG

    text: str
    agent_id: str | None = None


class ToolCallStartPayload(BaseModel):
    """Agent invokes a tool."""

    model_config = _CAMEL_CONFIG

    tool_use_id: str
    tool_name: str
    tool_input: dict[str, Any]
    agent_id: str | None = None


class ToolCallEndPayload(BaseModel):
    """Tool result returned to the agent."""

    model_config = _CAMEL_CONFIG

    tool_use_id: str
    tool_name: str = ""
    output: str
    is_error: bool = False
    agent_id: str | None = None


class SubagentStartPayload(BaseModel):
    """A child agent was spawned."""

    model_config = _CAMEL_CONFIG

    agent_id: str
    agent_type: str


class SubagentEndPayload(BaseModel):
    """Child agent finished."""

    model_config = _CAMEL_CONFIG

    agent_id: str


class CompactPayload(BaseModel):
    """Context compaction happened."""

    model_config = _CAMEL_CONFIG

    trigger: str
    pre_tokens: int = 0


class ProgressPayload(BaseModel):
    """Ephemeral status message (not persisted)."""

    model_config = _CAMEL_CONFIG

    message: str = ""


class NotificationPayload(BaseModel):
    """A user-visible message from the agent."""

    model_config = ConfigDict(extra="allow", alias_generator=to_camel, populate_by_name=True)

    message: str = ""
    type: str | None = None


class PermissionDeniedPayload(BaseModel):
    """A tool was blocked by the SDK."""

    model_config = ConfigDict(extra="allow", alias_generator=to_camel, populate_by_name=True)

    tool_name: str | None = None


class ReadyPayload(BaseModel):
    """Session is idle and waiting for input."""


class _TurnEndPayload(BaseModel):
    """Shared fields for turn-ending events."""

    model_config = _CAMEL_CONFIG

    turn_cost_usd: float = 0.0
    cost_usd: float = 0.0
    turns: int = 0
    turn_turns: int = 0
    duration_ms: int = 0
    usage: dict[str, Any] = Field(default_factory=dict)
    iterations: list[dict[str, Any]] = Field(default_factory=list)
    context_window: int = 0


class TurnCompletePayload(_TurnEndPayload):
    """Agent completed a turn successfully."""

    result: str = ""


class InterruptedPayload(_TurnEndPayload):
    """Turn was cancelled by the user."""


class ErrorPayload(_TurnEndPayload):
    """Turn failed with an error."""

    subtype: str = "turn_error"
    errors: list[str] = Field(default_factory=list)
    result: str = ""


class DonePayload(BaseModel):
    """Session closed gracefully after END_SIGNAL."""

    model_config = _CAMEL_CONFIG

    result: str = ""
    cost_usd: float = 0.0
    turns: int = 0
    duration_ms: int = 0
    usage: dict[str, Any] = Field(default_factory=dict)


class AskUserQuestionPayload(BaseModel):
    """Agent needs answers from the user."""

    model_config = _CAMEL_CONFIG

    questions: list[Question]
    attempt: int = 0
    request_id: str = ""


class ConfirmActionPayload(BaseModel):
    """Agent wants to use a tool and needs approval."""

    model_config = _CAMEL_CONFIG

    tool_name: str
    tool_input: dict[str, Any] = Field(default_factory=dict)
    tool_use_id: str | None = None
    attempt: int = 0
    request_id: str = ""
    description: str | None = None


class ConfirmStatementPayload(BaseModel):
    """Agent presents a statement for user confirmation."""

    model_config = _CAMEL_CONFIG

    statement: str
    request_id: str = ""


class SuggestSessionPayload(BaseModel):
    """Agent suggests creating a subsession."""

    model_config = _CAMEL_CONFIG

    skill: str = ""
    spec_ids: list[str] = Field(default_factory=list)
    name: str = ""
    reason: str = ""
    prompt: str | None = None
    request_id: str = ""


class SuggestDescriptionPayload(BaseModel):
    """Agent suggests a session description."""

    model_config = _CAMEL_CONFIG

    description: str
    section: str = ""
    request_id: str = ""


class RequestResolvedPayload(BaseModel):
    """User responded to a pending request."""

    model_config = _CAMEL_CONFIG

    request_id: str = ""
    response: dict[str, Any] | None = None


class RequestExpiredPayload(BaseModel):
    """Pending request timed out without a response."""

    model_config = _CAMEL_CONFIG

    request_id: str = ""
    reason: str = "timeout"


class UserMessagePayload(BaseModel):
    """Echoed user input, stored in the event log."""

    model_config = _CAMEL_CONFIG

    text: str
    is_markdown: bool = False


# ─── Typed agent event models ──────────────────────────────────────────────────
# Each variant has event_type: Literal["camelCase"] + a typed payload.
# Used for schema generation — see AgentEvent union at the bottom.

class _BaseEvent(BaseModel):
    """Common envelope fields shared by every agent event."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        json_schema_serialization_defaults_required=True,
    )

    bonsai_sid: str
    session_id: str = ""


class SessionStartEvent(_BaseEvent):
    event_type: Literal["sessionStart"] = "sessionStart"
    payload: SessionStartPayload


class TextDeltaEvent(_BaseEvent):
    event_type: Literal["textDelta"] = "textDelta"
    payload: TextDeltaPayload


class ToolCallStartEvent(_BaseEvent):
    event_type: Literal["toolCallStart"] = "toolCallStart"
    payload: ToolCallStartPayload


class ToolCallEndEvent(_BaseEvent):
    event_type: Literal["toolCallEnd"] = "toolCallEnd"
    payload: ToolCallEndPayload


class SubagentStartEvent(_BaseEvent):
    event_type: Literal["subagentStart"] = "subagentStart"
    payload: SubagentStartPayload


class SubagentEndEvent(_BaseEvent):
    event_type: Literal["subagentEnd"] = "subagentEnd"
    payload: SubagentEndPayload


class CompactEvent(_BaseEvent):
    event_type: Literal["compact"] = "compact"
    payload: CompactPayload


class ProgressEvent(_BaseEvent):
    event_type: Literal["progress"] = "progress"
    payload: ProgressPayload


class NotificationEvent(_BaseEvent):
    event_type: Literal["notification"] = "notification"
    payload: NotificationPayload


class PermissionDeniedEvent(_BaseEvent):
    event_type: Literal["permissionDenied"] = "permissionDenied"
    payload: PermissionDeniedPayload


class ReadyEvent(_BaseEvent):
    event_type: Literal["ready"] = "ready"
    payload: ReadyPayload = Field(default_factory=ReadyPayload)


class TurnCompleteEvent(_BaseEvent):
    event_type: Literal["turnComplete"] = "turnComplete"
    payload: TurnCompletePayload


class InterruptedEvent(_BaseEvent):
    event_type: Literal["interrupted"] = "interrupted"
    payload: InterruptedPayload


class ErrorEvent(_BaseEvent):
    event_type: Literal["error"] = "error"
    payload: ErrorPayload


class DoneEvent(_BaseEvent):
    event_type: Literal["done"] = "done"
    payload: DonePayload


class AskUserQuestionEvent(_BaseEvent):
    event_type: Literal["askUserQuestion"] = "askUserQuestion"
    payload: AskUserQuestionPayload


class ConfirmActionEvent(_BaseEvent):
    event_type: Literal["confirmAction"] = "confirmAction"
    payload: ConfirmActionPayload


class ConfirmStatementEvent(_BaseEvent):
    event_type: Literal["confirmStatement"] = "confirmStatement"
    payload: ConfirmStatementPayload


class SuggestSessionEvent(_BaseEvent):
    event_type: Literal["suggestSession"] = "suggestSession"
    payload: SuggestSessionPayload


class SuggestDescriptionEvent(_BaseEvent):
    event_type: Literal["suggestDescription"] = "suggestDescription"
    payload: SuggestDescriptionPayload


class RequestResolvedEvent(_BaseEvent):
    event_type: Literal["requestResolved"] = "requestResolved"
    payload: RequestResolvedPayload


class RequestExpiredEvent(_BaseEvent):
    event_type: Literal["requestExpired"] = "requestExpired"
    payload: RequestExpiredPayload


class UserMessageEvent(_BaseEvent):
    event_type: Literal["userMessage"] = "userMessage"
    payload: UserMessagePayload


# Discriminated union — single source of truth for both runtime validation
# and TypeScript type generation (via `uv run python -m app.cli export-ws-schema`).
AgentEvent = Annotated[
    Union[
        SessionStartEvent,
        TextDeltaEvent,
        ToolCallStartEvent,
        ToolCallEndEvent,
        SubagentStartEvent,
        SubagentEndEvent,
        CompactEvent,
        ProgressEvent,
        NotificationEvent,
        PermissionDeniedEvent,
        ReadyEvent,
        TurnCompleteEvent,
        InterruptedEvent,
        ErrorEvent,
        DoneEvent,
        AskUserQuestionEvent,
        ConfirmActionEvent,
        ConfirmStatementEvent,
        SuggestSessionEvent,
        SuggestDescriptionEvent,
        RequestResolvedEvent,
        RequestExpiredEvent,
        UserMessageEvent,
    ],
    Field(discriminator="event_type"),
]


def agent_event_json_schema() -> dict:
    """Return the JSON-serialisable AgentEvent schema ready for codegen.

    ``_BaseEvent`` sets ``json_schema_serialization_defaults_required=True``
    so Pydantic natively marks ``eventType`` (a defaulted Literal) as
    required — no manual patching needed.  ``mode="serialization"`` emits
    camelCase aliases.
    """
    from pydantic import TypeAdapter

    return TypeAdapter(AgentEvent).json_schema(by_alias=True, mode="serialization")


# ─── Other models ─────────────────────────────────────────────────────────────

class MessageTooLargeError(Exception):
    """Raised when a user message would consume too much of the remaining context."""

    def __init__(self, message: str, *, msg_tokens: int, remaining_tokens: int) -> None:
        super().__init__(message)
        self.msg_tokens = msg_tokens
        self.remaining_tokens = remaining_tokens


class AgentResult(BaseModel):
    """Terminal success result from an agent run."""

    model_config = _CAMEL_CONFIG

    bonsai_sid: str
    session_id: str
    result: str
    cost_usd: float
    turns: int
    duration_ms: int
    usage: dict[str, Any] = Field(default_factory=dict)


class AgentTask(BaseModel):
    """Task record tracking an agent run."""

    model_config = _CAMEL_CONFIG

    bonsai_sid: str = Field(default_factory=lambda: str(uuid4()))
    name: str = ""
    status: TaskStatus = "initializing"
    spec_ids: list[str] = Field(default_factory=list)
    file_paths: list[str] = Field(default_factory=list)
    skill_id: str | None = None
    session_prompt: str | None = None
    config: AgentConfig = Field(default_factory=AgentConfig)
    session_id: str | None = None
    meta_ticket_id: str | None = None
    system_prompt: str | None = None
    created_by: str | None = None
    created: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    parent_bonsai_sid: str | None = None
    subsession_type: SubsessionType | None = None
    subsession_context: str | None = None
    return_status: str | None = None
    return_summary: str | None = None
