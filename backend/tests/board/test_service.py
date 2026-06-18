from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.board.service import BoardService, TicketNotFoundError
from app.core.config import load_config


def _setup_board(tmp_path: Path) -> BoardService:
    """Create a minimal project and return a BoardService."""
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir()
    config = load_config(tmp_path)
    return BoardService(config)


class TestCreateTicket:
    def test_creates_folder_and_ticket_json(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("My ticket")
        assert t.title == "My ticket"
        ticket_dir = tmp_path / ".tr" / "tickets" / t.id
        assert ticket_dir.is_dir()
        assert (ticket_dir / "ticket.json").is_file()

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

    def test_delete_trashes_orchestrator_and_attached_sessions(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        svc.agent_service = MagicMock()
        t = svc.create_ticket("With sessions")
        svc.attach_session(t.id, "bs_step1")
        svc.attach_session(t.id, "bs_step2")
        svc.set_orchestrator(t.id, "bs_orch")

        svc.delete_ticket(t.id)

        trashed = {c.args[0] for c in svc.agent_service.trash_session.call_args_list}
        assert trashed == {"bs_step1", "bs_step2", "bs_orch"}

    def test_delete_without_agent_service_still_removes_ticket(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("No agent")
        svc.attach_session(t.id, "bs_x")
        svc.delete_ticket(t.id)
        with pytest.raises(TicketNotFoundError):
            svc.get_ticket(t.id)

    def test_delete_continues_when_a_trash_call_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        svc.agent_service = MagicMock()
        svc.agent_service.trash_session.side_effect = RuntimeError("boom")
        t = svc.create_ticket("Boom")
        svc.attach_session(t.id, "bs_a")
        svc.attach_session(t.id, "bs_b")

        svc.delete_ticket(t.id)  # swallows per-session failures

        assert svc.agent_service.trash_session.call_count == 2
        with pytest.raises(TicketNotFoundError):
            svc.get_ticket(t.id)


class TestLinking:
    def test_link_spec(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        updated = svc.link_spec(t.id, "spec-1")
        assert "spec-1" in updated.linked_spec_ids

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


class TestArtifactBookkeeping:
    def test_ensure_ticket_dir(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        d = svc.ensure_ticket_dir(t.id)
        assert d.is_dir()

    def test_write_product_design_records_path(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        svc.write_artifact(t.id, "product_design", "# pd")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.product_design_path == f".tr/tickets/{t.id}/product-design.md"

    def test_read_artifact_returns_none_when_missing(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        assert svc.read_artifact(t.id, "product_design") is None


class TestProductDesignAutoFallback:
    def test_empty_body_gets_first_paragraph(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        markdown = (
            "---\n"
            "ticket_id: mt_x\n"
            "kind: product_design\n"
            "---\n\n"
            "# Product design: Build feature X\n\n"
            "This feature lets users do Y. It serves Z by addressing the W gap.\n"
            "\n"
            "## Goal\n\n"
            "Detailed goal here.\n"
        )
        svc.write_artifact(t.id, "product_design", markdown)
        refreshed = svc.get_ticket(t.id)
        assert refreshed.body.startswith("This feature lets users do Y")

    def test_non_empty_body_is_preserved(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X", body="Pre-existing body")
        markdown = "# Title\n\nNew paragraph that should NOT overwrite.\n"
        svc.write_artifact(t.id, "product_design", markdown)
        refreshed = svc.get_ticket(t.id)
        assert refreshed.body == "Pre-existing body"

    def test_other_artifact_kinds_do_not_touch_body(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        svc.write_artifact(t.id, "technical_design", "# title\n\nfoo bar baz\n")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.body == ""




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

    def test_noop_when_no_references(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        svc.create_ticket("T")
        svc.detach_session_from_all("nonexistent")


