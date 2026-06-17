"""Analytics event union and consent record.

A closed, discriminated event model keyed on a ``Literal`` ``event`` field
(mirroring the ``AgentEvent`` union). Each user-facing feature has its own
event type. Events carry only the per-install ``installation_id`` plus
low-cardinality, non-personal environment metadata. ``EVENT_FIELD_ALLOWLIST``
is the machine-checked privacy invariant: the union of every field across
every event must be a subset of it.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

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

ANALYTICS_EVENT_MODELS: tuple[type[_AnalyticsEvent], ...] = (
    AppInstalledEvent,
    AppStartedEvent,
    AgentSessionStartedEvent,
    SpecsViewedEvent,
    SpecGraphViewedEvent,
    BoardViewedEvent,
    VoiceTranscriptRevisedEvent,
    VisualizationShownEvent,
    OrchestratorStepSuggestedEvent,
    UpgradeStartedEvent,
)

# Every field name that may appear on any event. A field outside this set is a
# potential content leak; ``tests/analytics/test_models.py`` asserts the union
# of all event fields equals this allowlist, so adding one fails CI.
EVENT_FIELD_ALLOWLIST: frozenset[str] = frozenset(
    {"event", "installation_id", "channel", "version", "os", "arch"}
)


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
