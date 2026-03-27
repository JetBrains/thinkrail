from __future__ import annotations

from app.board.models import MetaTicket, MetaTicketSummary


class TestMetaTicket:
    def test_defaults(self) -> None:
        t = MetaTicket(title="Test ticket")
        assert t.title == "Test ticket"
        assert t.status == "idea"
        assert t.type == "feature"
        assert t.body == ""
        assert t.plan_path is None
        assert t.orchestrator_session_id is None
        assert t.linked_spec_ids == []
        assert t.session_ids == []
        assert t.id.startswith("mt_")
        assert len(t.id) == 11  # mt_ + 8 hex chars

    def test_camel_case_serialization(self) -> None:
        t = MetaTicket(title="Test", linked_spec_ids=["s1"])
        d = t.model_dump(by_alias=True)
        assert "linkedSpecIds" in d
        assert "planPath" in d
        assert "orchestratorSessionId" in d
        assert "sessionIds" in d
        assert d["linkedSpecIds"] == ["s1"]

    def test_from_camel_case(self) -> None:
        t = MetaTicket(**{
            "title": "Test",
            "linkedSpecIds": ["s1"],
            "sessionIds": ["sid1"],
            "planPath": "plans/mt_test.md",
        })
        assert t.linked_spec_ids == ["s1"]
        assert t.session_ids == ["sid1"]
        assert t.plan_path == "plans/mt_test.md"


class TestMetaTicketSummary:
    def test_from_ticket(self) -> None:
        t = MetaTicket(title="Test", body="Long body")
        s = MetaTicketSummary(
            id=t.id, title=t.title, status=t.status, type=t.type,
        )
        assert s.id == t.id
        assert s.title == "Test"
        assert s.status == "idea"
