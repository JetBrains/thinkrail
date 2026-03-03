from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def to_camel(name: str) -> str:
    """Convert snake_case to camelCase for JSON serialization."""
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


_CAMEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)

TaskStatus = Literal["idle", "running", "done", "error"]

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
]


class AgentConfig(BaseModel):
    """Run configuration passed to the Claude Agent SDK."""

    model_config = _CAMEL_CONFIG

    model: str = "claude-sonnet-4-6"
    max_turns: int = 25
    permission_mode: str = "default"
    stream_text: bool = True


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

    task_id: str
    session_id: str
    event_type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)


class AgentResult(BaseModel):
    """Terminal success result from an agent run."""

    model_config = _CAMEL_CONFIG

    task_id: str
    session_id: str
    result: str
    cost_usd: float
    turns: int
    duration_ms: int
    usage: dict[str, Any] = Field(default_factory=dict)


class AgentTask(BaseModel):
    """Task record tracking an agent run."""

    model_config = _CAMEL_CONFIG

    id: str = Field(default_factory=lambda: str(uuid4()))
    status: TaskStatus = "idle"
    spec_ids: list[str] = Field(default_factory=list)
    config: AgentConfig = Field(default_factory=AgentConfig)
    session_id: str | None = None
    created: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
    updated: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())
