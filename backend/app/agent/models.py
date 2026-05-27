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

# Declared here (rather than in app.agent.runtime.types) because ``AgentConfig``
# embeds it, and ``runtime.types`` already imports from this module. The
# canonical export lives in ``app.agent.runtime`` for consumers; this is the
# definitional site.
RuntimeType = Literal["claude", "codex"]


class SubsessionType(str, Enum):
    """Type of subsession — determines return flow behavior."""

    discussion = "discussion"
    refinement = "refinement"


# ─── Interaction request/response models ──────────────────────────────────────

class AgentConfig(BaseModel):
    """User-facing run configuration. Persisted per session."""

    # ``extra="ignore"`` so older session files round-trip without raising
    # if they carry fields that have since been removed from this model.
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )

    runtime: RuntimeType = "claude"
    model: str = "claude-sonnet-4-6"
    permission_mode: str = "default"
    stream_text: bool = True
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
    # Same shape as ``AgentTask.outcome``. Bundling it here makes the
    # session-end + outcome transition atomic on the wire — the frontend
    # never sees ``status=done`` without the next-step contract.
    outcome: "SessionOutcome | None" = None


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


class SuggestStepPayload(BaseModel):
    """Orchestrator proposes the next plan step for execution."""

    model_config = _CAMEL_CONFIG

    ticket_id: str = ""
    step_number: int = 0
    step_title: str = ""
    skill: str = ""
    input_spec_ids: list[str] = Field(default_factory=list)
    agent_instructions: str = ""
    reason: str = ""
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
    event_type: Literal["sessionStart"]
    payload: SessionStartPayload


class TextDeltaEvent(_BaseEvent):
    event_type: Literal["textDelta"]
    payload: TextDeltaPayload


class ToolCallStartEvent(_BaseEvent):
    event_type: Literal["toolCallStart"]
    payload: ToolCallStartPayload


class ToolCallEndEvent(_BaseEvent):
    event_type: Literal["toolCallEnd"]
    payload: ToolCallEndPayload


class SubagentStartEvent(_BaseEvent):
    event_type: Literal["subagentStart"]
    payload: SubagentStartPayload


class SubagentEndEvent(_BaseEvent):
    event_type: Literal["subagentEnd"]
    payload: SubagentEndPayload


class CompactEvent(_BaseEvent):
    event_type: Literal["compact"]
    payload: CompactPayload


class ProgressEvent(_BaseEvent):
    event_type: Literal["progress"]
    payload: ProgressPayload


class NotificationEvent(_BaseEvent):
    event_type: Literal["notification"]
    payload: NotificationPayload


class PermissionDeniedEvent(_BaseEvent):
    event_type: Literal["permissionDenied"]
    payload: PermissionDeniedPayload


class ReadyEvent(_BaseEvent):
    event_type: Literal["ready"]
    payload: ReadyPayload = Field(default_factory=ReadyPayload)


class TurnCompleteEvent(_BaseEvent):
    event_type: Literal["turnComplete"]
    payload: TurnCompletePayload


class InterruptedEvent(_BaseEvent):
    event_type: Literal["interrupted"]
    payload: InterruptedPayload


class ErrorEvent(_BaseEvent):
    event_type: Literal["error"]
    payload: ErrorPayload


class DoneEvent(_BaseEvent):
    event_type: Literal["done"]
    payload: DonePayload


class AskUserQuestionEvent(_BaseEvent):
    event_type: Literal["askUserQuestion"]
    payload: AskUserQuestionPayload


class ConfirmActionEvent(_BaseEvent):
    event_type: Literal["confirmAction"]
    payload: ConfirmActionPayload


class SuggestSessionEvent(_BaseEvent):
    event_type: Literal["suggestSession"]
    payload: SuggestSessionPayload


class SuggestDescriptionEvent(_BaseEvent):
    event_type: Literal["suggestDescription"]
    payload: SuggestDescriptionPayload


class SuggestStepEvent(_BaseEvent):
    event_type: Literal["suggestStep"]
    payload: SuggestStepPayload


class RequestResolvedEvent(_BaseEvent):
    event_type: Literal["requestResolved"]
    payload: RequestResolvedPayload


class RequestExpiredEvent(_BaseEvent):
    event_type: Literal["requestExpired"]
    payload: RequestExpiredPayload


class UserMessageEvent(_BaseEvent):
    event_type: Literal["userMessage"]
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
        SuggestSessionEvent,
        SuggestDescriptionEvent,
        SuggestStepEvent,
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


# ─── Session outcome ──────────────────────────────────────────────────────────
# A skill emits an outcome at finalization. The frontend renders the outcome on
# the done screen as a banner + artifact previews + a row of action buttons.
# Adding new action types is intentionally cheap: add a new BaseModel below,
# include it in the OutcomeAction union, and teach the frontend dispatcher.


class OutcomeArtifact(BaseModel):
    """A file produced or finalized by the session — opened on the done screen."""

    model_config = _CAMEL_CONFIG

    path: str
    label: str | None = None
    open_on_done: bool = True


class CreateTicketAction(BaseModel):
    """Queued ticket creation. Rendered as an 'Add to board' button.

    `state="pending"` until the user clicks; `state="applied"` once the ticket
    has been created on the board.
    """

    model_config = _CAMEL_CONFIG

    type: Literal["create_ticket"] = "create_ticket"
    id: str
    title: str
    body: str | None = None
    state: Literal["pending", "applied"] = "pending"


class StartSessionAction(BaseModel):
    """Recommended follow-up session. Rendered as a primary/secondary CTA."""

    model_config = _CAMEL_CONFIG

    type: Literal["start_session"] = "start_session"
    id: str
    title: str
    description: str | None = None
    skill_id: str
    prompt: str | None = None
    primary: bool = False


class NavigateAction(BaseModel):
    """UI navigation only — no agent or tool call."""

    model_config = _CAMEL_CONFIG

    type: Literal["navigate"] = "navigate"
    id: str
    title: str
    description: str | None = None
    target: Literal["board", "specs", "graph", "files"]


OutcomeAction = Annotated[
    Union[CreateTicketAction, StartSessionAction, NavigateAction],
    Field(discriminator="type"),
]


class SessionOutcome(BaseModel):
    """What to show on the done screen of a session.

    Built up by the agent via `session_finalize` (and optionally `session_queue_action`).
    Persisted on the AgentTask so it survives reloads.
    """

    model_config = _CAMEL_CONFIG

    summary: str | None = None
    artifacts: list[OutcomeArtifact] = Field(default_factory=list)
    actions: list[OutcomeAction] = Field(default_factory=list)


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
    outcome: SessionOutcome | None = None


# Resolve forward refs for models that mention SessionOutcome before it was
# declared (DonePayload is defined earlier in the file because it is part of
# the agent event hierarchy).
DonePayload.model_rebuild()
