"""Stage completion → node done + orchestrator resume.

When a stage session finishes, ``AgentService._on_ticket_session_finished``
must flip the stage's WorkNode to done/failed and enqueue a resume message to
the ticket's orchestrator so the pipeline advances. ``complete_node`` is the
manual ("Complete stage") equivalent.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.agent.models import AgentConfig
from app.agent.service import AgentService
from app.board.service import BoardService
from app.core.config import load_config


def _service_with_ticket(tmp_path: Path) -> tuple[AgentService, BoardService, str, str]:
    (tmp_path / ".tr").mkdir(exist_ok=True)
    config = load_config(tmp_path)
    service = AgentService(config, MagicMock())
    board = BoardService(config)
    service.board_service = board

    ticket = board.create_ticket(title="T", spawn_orchestrator=False)
    board.apply(ticket.id, {"op": "proposePipeline", "nodes": [
        {"id": "pd", "title": "Product design", "skill": "ticket-product-design"},
        {"id": "td", "title": "Technical design", "skill": "ticket-technical-design",
         "dependsOn": ["pd"]},
    ]})
    board.apply(ticket.id, {"op": "recordRunStart", "id": "pd",
                            "run": {"kind": "session", "sessionId": "sess-pd",
                                    "status": "running"}})

    orch = service._tracker.create_task(
        [], AgentConfig(), skill_id="ticket-orchestrator", name="Orchestrator",
    )
    board.set_orchestrator(ticket.id, orch.thinkrail_sid)
    return service, board, ticket.id, orch.thinkrail_sid


def _node(board: BoardService, ticket_id: str, node_id: str):
    return next(n for n in board.get_ticket(ticket_id).stages if n.id == node_id)


class TestStageSessionFinished:
    def test_done_marks_node_done_and_resumes_orchestrator(self, tmp_path: Path) -> None:
        service, board, ticket_id, orch_sid = _service_with_ticket(tmp_path)
        task = SimpleNamespace(ticket_id=ticket_id, thinkrail_sid="sess-pd",
                               status="done", outcome=None, name="Product design")

        asyncio.run(service._on_ticket_session_finished(task))

        assert _node(board, ticket_id, "pd").status == "done"
        assert service._tracker._queues[orch_sid].qsize() == 1

    def test_error_marks_node_failed_and_still_resumes(self, tmp_path: Path) -> None:
        service, board, ticket_id, orch_sid = _service_with_ticket(tmp_path)
        task = SimpleNamespace(ticket_id=ticket_id, thinkrail_sid="sess-pd",
                               status="error", outcome=None, name="Product design")

        asyncio.run(service._on_ticket_session_finished(task))

        assert _node(board, ticket_id, "pd").status == "failed"
        assert service._tracker._queues[orch_sid].qsize() == 1

    def test_orchestrator_finishing_does_not_self_resume(self, tmp_path: Path) -> None:
        service, board, ticket_id, orch_sid = _service_with_ticket(tmp_path)
        task = SimpleNamespace(ticket_id=ticket_id, thinkrail_sid=orch_sid,
                               status="done", outcome=None, name="Orchestrator")

        asyncio.run(service._on_ticket_session_finished(task))

        assert service._tracker._queues[orch_sid].qsize() == 0


class TestCompleteNode:
    def test_marks_node_done_and_resumes(self, tmp_path: Path) -> None:
        service, board, ticket_id, orch_sid = _service_with_ticket(tmp_path)

        asyncio.run(service.complete_node(ticket_id, "pd"))

        assert _node(board, ticket_id, "pd").status == "done"
        assert service._tracker._queues[orch_sid].qsize() == 1

    def test_completes_an_unstarted_node(self, tmp_path: Path) -> None:
        service, board, ticket_id, orch_sid = _service_with_ticket(tmp_path)

        # "td" was never started (no runs); a manual completion still flips it.
        asyncio.run(service.complete_node(ticket_id, "td"))

        assert _node(board, ticket_id, "td").status == "done"
