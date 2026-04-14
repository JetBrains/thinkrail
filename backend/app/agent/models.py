from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal
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

EventType = Literal[
    "session_start",
    "text_delta",
    "tool_call_start",
    "tool_call_end",
    "turn_complete",
    "interrupted",
    "subagent_start",
    "subagent_end",
    "notification",
    "compact",
    "progress",
    "done",
    "error",
    "permission_denied",
    "ready",
]


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


class AgentEvent(BaseModel):
    """Serializable event sent as a notification to the frontend."""

    model_config = _CAMEL_CONFIG

    bonsai_sid: str
    session_id: str
    event_type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


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
