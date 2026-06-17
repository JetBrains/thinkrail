"""Anonymous usage analytics — privacy-first, opt-out by default.

The only stable identifier is a per-install ``installation_id`` (``uuid4``);
events carry only non-personal environment metadata. See ``README.md`` for the
module design and the privacy invariant.
"""

from app.analytics import models
from app.analytics.consent import get_status, opt_in, opt_out, run_cli
from app.analytics.models import (
    AgentSessionStartedEvent,
    AnalyticsConsent,
    AnalyticsEvent,
    AnalyticsStatus,
    AppInstalledEvent,
    AppStartedEvent,
    BoardViewedEvent,
    OrchestratorStepSuggestedEvent,
    SpecGraphViewedEvent,
    SpecsViewedEvent,
    UpgradeStartedEvent,
    VisualizationShownEvent,
    VoiceTranscriptRevisedEvent,
)
from app.analytics.service import (
    emit_oneshot,
    initialize,
    reload_state,
    track_event,
)

__all__ = [
    "initialize",
    "track_event",
    "opt_in",
    "opt_out",
    "get_status",
    "reload_state",
    "emit_oneshot",
    "run_cli",
    "models",
    "AnalyticsConsent",
    "AnalyticsStatus",
    "AnalyticsEvent",
    "AppInstalledEvent",
    "AppStartedEvent",
    "AgentSessionStartedEvent",
    "SpecsViewedEvent",
    "SpecGraphViewedEvent",
    "BoardViewedEvent",
    "VoiceTranscriptRevisedEvent",
    "VisualizationShownEvent",
    "OrchestratorStepSuggestedEvent",
    "UpgradeStartedEvent",
]
