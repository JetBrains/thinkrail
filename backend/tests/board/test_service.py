from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError
from app.core.config import load_config


def _setup_board(tmp_path: Path) -> BoardService:
    """Create a minimal project and return a BoardService."""
    specs_dir = tmp_path / ".specs"
    specs_dir.mkdir()
    reg = {"version": "2.0", "project": "test", "specs": [], "links": []}
    (specs_dir / "registry.json").write_text(json.dumps(reg), encoding="utf-8")
    config = load_config(tmp_path)
    return BoardService(config)


class TestCreateTicket:
    def test_creates_file(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("My ticket")
        assert t.title == "My ticket"
        assert t.status == "idea"
        assert (tmp_path / ".bonsai" / "meta-tickets" / f"{t.id}.json").exists()

    def test_with_body_and_type(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Bug", body="Something broke", type="bug")
        assert t.body == "Something broke"
        assert t.type == "bug"


class TestGetTicket:
    def test_get_existing(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        created = svc.create_ticket("Test")
        fetched = svc.get_ticket(created.id)
        assert fetched.id == created.id
        assert fetched.title == "Test"

    def test_get_missing_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        with pytest.raises(TicketNotFoundError):
            svc.get_ticket("mt_nonexistent")


class TestListTickets:
    def test_empty(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        assert svc.list_tickets() == []

    def test_lists_all(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        svc.create_ticket("A")
        svc.create_ticket("B")
        tickets = svc.list_tickets()
        assert len(tickets) == 2


class TestUpdateTicket:
    def test_update_title(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Old")
        updated = svc.update_ticket(t.id, title="New")
        assert updated.title == "New"

    def test_update_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        updated = svc.update_ticket(t.id, status="specified")
        assert updated.status == "specified"

    def test_invalid_transition_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        with pytest.raises(InvalidTransitionError):
            svc.update_ticket(t.id, status="executing")

    def test_update_missing_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        with pytest.raises(TicketNotFoundError):
            svc.update_ticket("mt_nope", title="X")


class TestDeleteTicket:
    def test_delete(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Delete me")
        svc.delete_ticket(t.id)
        with pytest.raises(TicketNotFoundError):
            svc.get_ticket(t.id)

    def test_delete_missing_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        with pytest.raises(TicketNotFoundError):
            svc.delete_ticket("mt_nope")


class TestLinking:
    def test_link_spec(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        updated = svc.link_spec(t.id, "spec-1")
        assert "spec-1" in updated.linked_spec_ids

    def test_link_spec_auto_transitions_to_specified(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        assert t.status == "idea"
        updated = svc.link_spec(t.id, "spec-1")
        assert updated.status == "specified"

    def test_link_spec_idempotent(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        svc.link_spec(t.id, "spec-1")
        updated = svc.link_spec(t.id, "spec-1")
        assert updated.linked_spec_ids.count("spec-1") == 1

    def test_unlink_spec(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        svc.link_spec(t.id, "spec-1")
        updated = svc.unlink_spec(t.id, "spec-1")
        assert "spec-1" not in updated.linked_spec_ids

    def test_attach_session(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        updated = svc.attach_session(t.id, "session-1")
        assert "session-1" in updated.session_ids

    def test_set_plan_path(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        svc.update_ticket(t.id, status="specified")
        updated = svc.set_plan_path(t.id, "plans/mt_test.md")
        assert updated.plan_path == "plans/mt_test.md"
        assert updated.status == "planned"

    def test_set_orchestrator(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        svc.update_ticket(t.id, status="specified")
        svc.set_plan_path(t.id, "plans/mt_test.md")
        updated = svc.set_orchestrator(t.id, "orch-session-1")
        assert updated.orchestrator_session_id == "orch-session-1"
        assert updated.status == "executing"


class TestDetachSessionFromAll:
    def test_removes_from_all_tickets(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t1 = svc.create_ticket("T1")
        t2 = svc.create_ticket("T2")
        svc.attach_session(t1.id, "sess-x")
        svc.attach_session(t2.id, "sess-x")
        svc.attach_session(t1.id, "sess-y")

        svc.detach_session_from_all("sess-x")

        t1 = svc.get_ticket(t1.id)
        t2 = svc.get_ticket(t2.id)
        assert "sess-x" not in t1.session_ids
        assert "sess-y" in t1.session_ids
        assert "sess-x" not in t2.session_ids

    def test_clears_orchestrator(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("T")
        svc.attach_session(t.id, "orch-1")
        svc.update_ticket(t.id, status="specified")
        svc.set_plan_path(t.id, "plans/test.md")
        svc.set_orchestrator(t.id, "orch-1")

        svc.detach_session_from_all("orch-1")

        t = svc.get_ticket(t.id)
        assert t.orchestrator_session_id is None
        assert "orch-1" not in t.session_ids

    def test_noop_when_no_references(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        svc.create_ticket("T")
        svc.detach_session_from_all("nonexistent")  # should not raise
