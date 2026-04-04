from __future__ import annotations

from app.board.models import MetaTicket, MetaTicketSummary, SpecPatch


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


class TestSpecPatch:
    def test_defaults(self) -> None:
        p = SpecPatch(
            spec_id="mod-runner",
            spec_title="Agent Runner",
            operation="created",
            patch_path="spec-patches/mt_abc/mod-runner-2026.patch",
            spec_path="backend/app/agent/README.md",
            session_id="sid-1",
        )
        assert p.spec_id == "mod-runner"
        assert p.operation == "created"
        assert p.created  # auto-generated

    def test_camel_serialization(self) -> None:
        p = SpecPatch(
            spec_id="x", spec_title="X", operation="modified",
            patch_path="p.patch", spec_path="x.md", session_id="s",
        )
        d = p.model_dump(by_alias=True)
        assert "specId" in d
        assert "patchPath" in d
        assert "specPath" in d
        assert "sessionId" in d


class TestMetaTicketSummary:
    def test_from_ticket(self) -> None:
        t = MetaTicket(title="Test", body="Long body")
        s = MetaTicketSummary(
            id=t.id, title=t.title, status=t.status, type=t.type,
        )
        assert s.id == t.id
        assert s.title == "Test"
        assert s.status == "idea"
