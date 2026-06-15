from __future__ import annotations

from app.board.models import OrchestrationConfig, Ticket, TicketSummary
from app.board.work_node import WorkNode


class TestOrchestratorRef:
    def test_ticket_migrates_legacy_orchestrator_session_id(self) -> None:
        t = Ticket.model_validate({"title": "x", "orchestratorSessionId": "sess-1"})
        assert t.orchestrator is not None
        assert t.orchestrator.kind == "session"
        assert t.orchestrator.session_id == "sess-1"

    def test_ticket_migrates_legacy_orchestrator_session_id_snake(self) -> None:
        t = Ticket.model_validate({"title": "x", "orchestrator_session_id": "sess-2"})
        assert t.orchestrator is not None
        assert t.orchestrator.session_id == "sess-2"

    def test_ticket_migrate_does_not_clobber_explicit_orchestrator(self) -> None:
        t = Ticket.model_validate({
            "title": "x",
            "orchestrator": {"kind": "session", "sessionId": "explicit"},
            "orchestratorSessionId": "legacy",
        })
        assert t.orchestrator is not None
        assert t.orchestrator.session_id == "explicit"

    def test_ticket_orchestrator_defaults_none(self) -> None:
        assert Ticket(title="x").orchestrator is None


class TestTicket:
    def test_defaults(self) -> None:
        t = Ticket(title="Test ticket")
        assert t.title == "Test ticket"
        assert t.type == "feature"
        assert t.body == ""
        assert t.product_design_path is None
        assert t.technical_design_path is None
        assert t.history_path is None
        assert t.implementation_plan_path is None
        assert t.orchestrator is None
        assert t.linked_spec_ids == []
        assert t.session_ids == []
        assert t.stages == []
        assert t.id.startswith("mt_")
        assert len(t.id) == 11

    def test_orchestration_defaults(self) -> None:
        t = Ticket(title="t")
        assert t.orchestration.stage_gate == "approve"
        assert t.orchestration.step_gate == "approve"
        assert t.orchestration.failure_policy == "fail-fast"
        assert t.orchestration.step_execution == "interactive"
        assert t.orchestration.artifact_edits == "ask"

    def test_camel_case_serialization(self) -> None:
        t = Ticket(title="Test", linked_spec_ids=["s1"])
        d = t.model_dump(by_alias=True)
        assert "linkedSpecIds" in d
        assert "productDesignPath" in d
        assert "technicalDesignPath" in d
        assert "historyPath" in d
        assert "implementationPlanPath" in d
        assert "orchestrator" in d
        assert "sessionIds" in d
        assert "stages" in d
        assert "orchestration" in d
        assert d["linkedSpecIds"] == ["s1"]

    def test_from_camel_case(self) -> None:
        t = Ticket(**{
            "title": "Test",
            "linkedSpecIds": ["s1"],
            "sessionIds": ["sid1"],
            "implementationPlanPath": ".tr/tickets/mt_test/implementation-plan.md",
        })
        assert t.linked_spec_ids == ["s1"]
        assert t.session_ids == ["sid1"]
        assert t.implementation_plan_path == ".tr/tickets/mt_test/implementation-plan.md"

    def test_stages_with_work_nodes(self) -> None:
        node = WorkNode(id="stage-1", title="Product design", skill="ticket-product-design")
        t = Ticket(title="t", stages=[node])
        assert len(t.stages) == 1
        assert t.stages[0].id == "stage-1"

    def test_orchestration_config_camel(self) -> None:
        oc = OrchestrationConfig(stage_gate="autonomous", step_gate="autonomous")
        d = oc.model_dump(by_alias=True)
        assert d["stageGate"] == "autonomous"
        assert d["stepGate"] == "autonomous"
        assert d["failurePolicy"] == "fail-fast"


class TestTicketSummary:
    def test_from_ticket_no_stages(self) -> None:
        t = Ticket(title="Test", body="Long body")
        s = TicketSummary.from_ticket(t)
        assert s.id == t.id
        assert s.title == "Test"
        assert s.lifecycle == "created"

    def test_from_ticket_design_in_progress(self) -> None:
        node = WorkNode(id="n1", title="Design", status="running")
        t = Ticket(title="t", stages=[node])
        s = TicketSummary.from_ticket(t)
        assert s.lifecycle == "design"

    def test_from_ticket_implementation(self) -> None:
        design = WorkNode(id="n1", title="Design", status="done")
        impl = WorkNode(id="n2", title="Implement", executes_plan=True, status="running",
                        depends_on=["n1"])
        t = Ticket(title="t", stages=[design, impl])
        s = TicketSummary.from_ticket(t)
        assert s.lifecycle == "implementation"

    def test_from_ticket_done(self) -> None:
        terminal = WorkNode(id="n1", title="Done", status="done")
        t = Ticket(title="t", stages=[terminal])
        s = TicketSummary.from_ticket(t)
        assert s.lifecycle == "done"
