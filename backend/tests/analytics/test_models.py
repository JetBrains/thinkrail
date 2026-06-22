from __future__ import annotations

import pytest
from pydantic import TypeAdapter, ValidationError

from app.analytics.models import (
    ANALYTICS_EVENT_MODELS,
    EVENT_FIELD_ALLOWLIST,
    AgentSessionCompletedEvent,
    AnalyticsConsent,
    AnalyticsEvent,
    AnalyticsStatus,
    AppInstalledEvent,
    BoardViewedEvent,
    SpecsViewedEvent,
)


def _field_union() -> set[str]:
    union: set[str] = set()
    for model in ANALYTICS_EVENT_MODELS:
        union |= set(model.model_fields.keys())
    return union


class TestPrivacyInvariant:
    def test_event_field_union_equals_allowlist(self) -> None:
        # The hard invariant: every field on every event is in the allowlist,
        # and the allowlist names nothing the events don't actually use. A new
        # content-leaking field on any event breaks this.
        assert _field_union() == EVENT_FIELD_ALLOWLIST

    def test_no_content_fields_leak(self) -> None:
        forbidden = {
            "path", "project_root", "name", "spec_id", "ticket_id", "file_paths",
            "prompt", "code", "transcript", "hostname", "username", "ip",
        }
        assert _field_union() & forbidden == set()


class TestEventUnion:
    def test_discriminated_union_validates_by_event(self) -> None:
        ta = TypeAdapter(AnalyticsEvent)
        event = ta.validate_python({"event": "board_viewed"})
        assert isinstance(event, BoardViewedEvent)

    def test_schema_has_event_discriminator(self) -> None:
        schema = TypeAdapter(AnalyticsEvent).json_schema(by_alias=True)
        assert schema["discriminator"]["propertyName"] == "event"

    def test_serializes_installation_id_as_camel(self) -> None:
        wire = AppInstalledEvent(installation_id="abc").model_dump(by_alias=True)
        assert wire["installationId"] == "abc"
        assert wire["event"] == "app_installed"

    def test_feature_event_carries_only_event_and_id(self) -> None:
        wire = SpecsViewedEvent(installation_id="x").model_dump(by_alias=True)
        assert set(wire) == {"event", "installationId"}
        assert wire["event"] == "specs_viewed"

    def test_session_completed_carries_only_enum_dimensions(self) -> None:
        wire = AgentSessionCompletedEvent(
            installation_id="x", outcome="error", files_written_bucket="4-10"
        ).model_dump(by_alias=True)
        assert set(wire) == {"event", "installationId", "outcome", "filesWrittenBucket"}
        assert wire["outcome"] == "error"
        assert wire["filesWrittenBucket"] == "4-10"

    def test_session_completed_rejects_out_of_range_bucket(self) -> None:
        ta = TypeAdapter(AnalyticsEvent)
        with pytest.raises(ValidationError):
            ta.validate_python(
                {"event": "agent_session_completed", "filesWrittenBucket": "7"}
            )


class TestConsentModel:
    def test_defaults_to_opt_out_posture(self) -> None:
        consent = AnalyticsConsent()
        assert consent.enabled is True
        assert consent.installation_id is None

    def test_round_trip_camel_and_snake(self) -> None:
        consent = AnalyticsConsent(enabled=False, installation_id="x")
        assert AnalyticsConsent.model_validate(consent.model_dump()).installation_id == "x"
        assert AnalyticsConsent.model_validate({"installationId": "y"}).installation_id == "y"


class TestWireStatus:
    def test_status_never_carries_installation_id(self) -> None:
        # The wire view exposes only `enabled`; the id stays backend-side.
        assert "installation_id" not in AnalyticsStatus.model_fields
        assert set(AnalyticsStatus(enabled=True).model_dump(by_alias=True)) == {"enabled"}
