from __future__ import annotations

from app.board.models import Ticket, TicketSummary


class TestTicket:
    def test_defaults(self) -> None:
        t = Ticket(title="Test ticket")
        assert t.title == "Test ticket"
        assert t.status == "idea"
        assert t.type == "feature"
        assert t.body == ""
        assert t.product_design_path is None
        assert t.technical_design_path is None
        assert t.history_path is None
        assert t.implementation_plan_path is None
        assert t.technical_design_stale is False
        assert t.history_stale is False
        assert t.implementation_plan_stale is False
        assert t.orchestrator_session_id is None
        assert t.linked_spec_ids == []
        assert t.session_ids == []
        assert t.id.startswith("mt_")
        assert len(t.id) == 11

    def test_camel_case_serialization(self) -> None:
        t = Ticket(title="Test", linked_spec_ids=["s1"])
        d = t.model_dump(by_alias=True)
        assert "linkedSpecIds" in d
        assert "productDesignPath" in d
        assert "technicalDesignPath" in d
        assert "historyPath" in d
        assert "implementationPlanPath" in d
        assert "technicalDesignStale" in d
        assert "historyStale" in d
        assert "implementationPlanStale" in d
        assert "orchestratorSessionId" in d
        assert "sessionIds" in d
        assert d["linkedSpecIds"] == ["s1"]

    def test_from_camel_case(self) -> None:
        t = Ticket(**{
            "title": "Test",
            "linkedSpecIds": ["s1"],
            "sessionIds": ["sid1"],
            "implementationPlanPath": ".tr/tickets/mt_test/implementation-plan.md",
            "technicalDesignStale": True,
        })
        assert t.linked_spec_ids == ["s1"]
        assert t.session_ids == ["sid1"]
        assert t.implementation_plan_path == ".tr/tickets/mt_test/implementation-plan.md"
        assert t.technical_design_stale is True


class TestTicketSummary:
    def test_from_ticket(self) -> None:
        t = Ticket(title="Test", body="Long body")
        s = TicketSummary.from_ticket(t)
        assert s.id == t.id
        assert s.title == "Test"
        assert s.status == "idea"

    def test_summary_carries_stale_flags(self) -> None:
        t = Ticket(
            title="x",
            technical_design_stale=True,
            history_stale=True,
            implementation_plan_stale=False,
        )
        s = TicketSummary.from_ticket(t)
        assert s.technical_design_stale is True
        assert s.history_stale is True
        assert s.implementation_plan_stale is False


class TestSkippedPhases:
    def test_default_skipped_phases_is_empty(self) -> None:
        t = Ticket(title="t")
        assert t.skipped_phases == []

    def test_skipped_phases_roundtrip(self) -> None:
        t = Ticket(title="t", skipped_phases=["product-design", "technical-design"])
        dumped = t.model_dump(by_alias=True)
        assert dumped["skippedPhases"] == ["product-design", "technical-design"]
        reloaded = Ticket.model_validate(dumped)
        assert reloaded.skipped_phases == ["product-design", "technical-design"]

    def test_summary_carries_skipped_phases(self) -> None:
        t = Ticket(title="t", skipped_phases=["technical-design"])
        s = TicketSummary.from_ticket(t)
        assert s.skipped_phases == ["technical-design"]
