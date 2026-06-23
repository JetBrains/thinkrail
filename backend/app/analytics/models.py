"""Analytics event union and consent record.

A closed, discriminated event model keyed on a ``Literal`` ``event`` field
(mirroring the ``AgentEvent`` union). Each user-facing feature has its own
event type. Events carry only the per-install ``installation_id`` plus
low-cardinality, non-personal environment metadata. ``EVENT_FIELD_ALLOWLIST``
is the machine-checked privacy invariant: the union of every field across
every event must be a subset of it.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union, get_args

from pydantic import BaseModel, ConfigDict, Field

from app.agent.models import to_camel

_CAMEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# ── Event union ────────────────────────────────────────────────────────
#
# ``installation_id`` and the environment fields default to empty so callers
# construct a bare event (e.g. ``BoardViewedEvent()``); ``service.track_event``
# stamps the rest from the active consent record and environment.


class _AnalyticsEvent(BaseModel):
    """Fields shared by every analytics event."""

    model_config = _CAMEL_CONFIG

    installation_id: str = ""


class _EnvEvent(_AnalyticsEvent):
    """Lifecycle events that additionally carry environment metadata."""

    channel: str = ""
    version: str = ""
    os: str = ""
    arch: str = ""


# Lifecycle (carry environment metadata)


class AppInstalledEvent(_EnvEvent):
    event: Literal["app_installed"] = "app_installed"


class AppStartedEvent(_EnvEvent):
    event: Literal["app_started"] = "app_started"


# Top-level feature usage (carry only the installation id)


class AgentSessionStartedEvent(_AnalyticsEvent):
    event: Literal["agent_session_started"] = "agent_session_started"


class AgentSessionCompletedEvent(_AnalyticsEvent):
    """A session reached a terminal state.

    ``outcome`` is the coarse end state; ``files_written_bucket`` is the
    bucketed count of distinct files the session wrote or edited (never the
    raw count or any path). Together they answer "do sessions finish, and do
    they produce changes" without inspecting what was changed.
    """

    event: Literal["agent_session_completed"] = "agent_session_completed"
    outcome: Literal["completed", "error", "cancelled"] = "completed"
    files_written_bucket: Literal["0", "1-3", "4-10", "11+"] = "0"


class OnboardingStepCompletedEvent(_AnalyticsEvent):
    """A wizard step session reached a terminal state. ``step`` is derived
    backend-side from the session's skill id (see ``ONBOARDING_STEP_BY_SKILL``)."""

    event: Literal["onboarding_step_completed"] = "onboarding_step_completed"
    step: Literal["goal_and_requirements", "architecture", "investigation"] = (
        "goal_and_requirements"
    )
    outcome: Literal["completed", "error", "cancelled"] = "completed"


class OnboardingOutcomeActionEvent(_AnalyticsEvent):
    """The fork a user took on a wizard step's done-screen. Frontend-originated
    (the only such event) — the choice is a client-side action the backend
    cannot observe."""

    event: Literal["onboarding_outcome_action"] = "onboarding_outcome_action"
    step: Literal["goal_and_requirements", "architecture", "investigation"] = (
        "goal_and_requirements"
    )
    action: Literal["continue", "open_workspace", "add_suggested_tickets"] = "continue"


class ProjectCreatedEvent(_AnalyticsEvent):
    """A project folder was registered for the first time. ``kind`` is its
    starting state — greenfield (``new``), an existing codebase (``existing``),
    or one already carrying ThinkRail deliverables (``initialized``)."""

    event: Literal["project_created"] = "project_created"
    kind: Literal["new", "existing", "initialized"] = "new"


class SpecsViewedEvent(_AnalyticsEvent):
    event: Literal["specs_viewed"] = "specs_viewed"


class SpecGraphViewedEvent(_AnalyticsEvent):
    event: Literal["spec_graph_viewed"] = "spec_graph_viewed"


class BoardViewedEvent(_AnalyticsEvent):
    event: Literal["board_viewed"] = "board_viewed"


class VoiceTranscriptRevisedEvent(_AnalyticsEvent):
    event: Literal["voice_transcript_revised"] = "voice_transcript_revised"


class VisualizationShownEvent(_AnalyticsEvent):
    event: Literal["visualization_shown"] = "visualization_shown"


class OrchestratorStepSuggestedEvent(_AnalyticsEvent):
    event: Literal["orchestrator_step_suggested"] = "orchestrator_step_suggested"


class UpgradeStartedEvent(_AnalyticsEvent):
    event: Literal["upgrade_started"] = "upgrade_started"


AnalyticsEvent = Annotated[
    Union[
        AppInstalledEvent,
        AppStartedEvent,
        AgentSessionStartedEvent,
        AgentSessionCompletedEvent,
        OnboardingStepCompletedEvent,
        OnboardingOutcomeActionEvent,
        ProjectCreatedEvent,
        SpecsViewedEvent,
        SpecGraphViewedEvent,
        BoardViewedEvent,
        VoiceTranscriptRevisedEvent,
        VisualizationShownEvent,
        OrchestratorStepSuggestedEvent,
        UpgradeStartedEvent,
    ],
    Field(discriminator="event"),
]


# ── Privacy invariant ──────────────────────────────────────────────────

# The union's members, unwrapped from the ``Annotated[Union[...], Field(...)]``
# alias — derived rather than re-listed so the two never drift.
ANALYTICS_EVENT_MODELS: tuple[type[_AnalyticsEvent], ...] = get_args(
    get_args(AnalyticsEvent)[0]
)

# Every field name that may appear on any event. A field outside this set is a
# potential content leak; ``tests/analytics/test_models.py`` asserts the union
# of all event fields equals this allowlist, so adding one fails CI.
EVENT_FIELD_ALLOWLIST: frozenset[str] = frozenset(
    {
        "event",
        "installation_id",
        "channel",
        "version",
        "os",
        "arch",
        "outcome",
        "files_written_bucket",
        "step",
        "action",
        "kind",
    }
)


# Maps a session's ``skill_id`` to its coarse onboarding step; a skill absent
# here is not a wizard step.
ONBOARDING_STEP_BY_SKILL: dict[str, str] = {
    "new-project": "goal_and_requirements",
    "goal-and-requirements": "goal_and_requirements",
    "architecture-design": "architecture",
    "investigate-project": "investigation",
}


# ── Consent record ─────────────────────────────────────────────────────


class AnalyticsConsent(BaseModel):
    """The single runtime source of truth for analytics consent.

    Persisted as JSON in ``AppStore`` under ``ANALYTICS_KEY``. ``enabled``
    defaults to ``True`` (opt-out posture); ``installation_id`` is ``None``
    until consent is active. Backend-internal — never crosses the wire (see
    :class:`AnalyticsStatus`).
    """

    model_config = _CAMEL_CONFIG

    enabled: bool = True
    installation_id: str | None = None


class AnalyticsStatus(BaseModel):
    """Wire view of consent for the in-app toggle.

    Every analytics event is stamped and sent backend-side, so the frontend
    never needs the ``installation_id`` — only the ``enabled`` flag crosses
    the wire. No default: the handler always sets it, so the field is required
    on the wire (non-optional in the generated TypeScript).
    """

    model_config = _CAMEL_CONFIG

    enabled: bool
