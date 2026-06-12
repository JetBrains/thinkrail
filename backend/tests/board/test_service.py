from __future__ import annotations

from pathlib import Path

import pytest

from app.board.service import BoardService, TicketNotFoundError
from app.board.state_machine import InvalidTransitionError
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
        assert t.status == "idea"
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

    def test_update_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        updated = svc.update_ticket(t.id, status="product-design")
        assert updated.status == "product-design"

    def test_invalid_transition_raises(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        with pytest.raises(InvalidTransitionError):
            svc.update_ticket(t.id, status="implementing")

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

    def test_set_orchestrator_auto_implementing(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("Test")
        for status in ("product-design", "technical-design", "amend-specs", "implementation-plan"):
            svc.update_ticket(t.id, status=status)
        updated = svc.set_orchestrator(t.id, "orch-session-1")
        assert updated.orchestrator_session_id == "orch-session-1"
        assert updated.status == "implementing"


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

    def test_write_technical_design_clears_stale(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        from app.board.storage import ticket_path as tp, write_ticket
        t2 = svc.get_ticket(t.id)
        t2.technical_design_stale = True
        write_ticket(tp(tmp_path / ".tr" / "tickets", t.id), t2)

        svc.write_artifact(t.id, "technical_design", "# dd")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.technical_design_path == f".tr/tickets/{t.id}/technical-design.md"
        assert refreshed.technical_design_stale is False

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


class TestStaleFlagsOnBackwardTransitions:
    def test_technical_design_to_product_design(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        svc.update_ticket(t.id, status="product-design")
        svc.update_ticket(t.id, status="technical-design")
        svc.update_ticket(t.id, status="product-design")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.technical_design_stale is True
        assert refreshed.history_stale is False

    def test_amend_specs_to_technical_design(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        for status in ("product-design", "technical-design", "amend-specs"):
            svc.update_ticket(t.id, status=status)
        svc.update_ticket(t.id, status="technical-design")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.history_stale is True

    def test_implementation_plan_to_amend_specs(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("X")
        for status in ("product-design", "technical-design", "amend-specs", "implementation-plan"):
            svc.update_ticket(t.id, status=status)
        svc.update_ticket(t.id, status="amend-specs")
        refreshed = svc.get_ticket(t.id)
        assert refreshed.implementation_plan_stale is True


class TestOnStatusChangeCommit:
    def test_amend_specs_to_implementation_plan_commits_paths(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc = _setup_board(tmp_path)
        captured: list[tuple[list[str], str]] = []
        monkeypatch.setattr(
            svc, "_commit_paths",
            lambda paths, msg: captured.append((paths, msg)),
        )

        t = svc.create_ticket("X")
        for status in ("product-design", "technical-design", "amend-specs"):
            svc.update_ticket(t.id, status=status)
        captured.clear()  # ignore any commits from earlier transitions

        svc.update_ticket(t.id, status="implementation-plan")

        assert len(captured) == 1
        paths, msg = captured[0]
        assert ".tr/design_docs" in paths
        assert f".tr/tickets/{t.id}/history.patch" in paths
        assert t.id in msg
        assert "amend" in msg.lower()

    def test_no_commit_on_backward_transition(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc = _setup_board(tmp_path)
        captured: list = []
        monkeypatch.setattr(
            svc, "_commit_paths",
            lambda paths, msg: captured.append((paths, msg)),
        )

        t = svc.create_ticket("X")
        for status in (
            "product-design", "technical-design", "amend-specs",
            "implementation-plan",
        ):
            svc.update_ticket(t.id, status=status)
        captured.clear()

        svc.update_ticket(t.id, status="amend-specs")
        assert captured == []  # backward = stale flag only, no commit


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


class TestUpdateTicketSkipAware:
    def test_lands_on_skipped_phase_walks_past(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.update_ticket(t.id, status="product-design")
        svc.skip_phase(t.id, "technical-design")
        # Agent attempts to advance to technical-design — should land on amend-specs
        updated = svc.update_ticket(t.id, status="technical-design")
        assert updated.status == "amend-specs"

    def test_backward_transition_ignores_skip_list(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.update_ticket(t.id, status="product-design")
        svc.update_ticket(t.id, status="technical-design")
        svc.skip_phase(t.id, "product-design")
        # Backward transition technical-design -> product-design should still work
        updated = svc.update_ticket(t.id, status="product-design")
        assert updated.status == "product-design"


class TestSkipPhase:
    def test_appends_to_list(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        updated = svc.skip_phase(t.id, "product-design")
        assert updated.skipped_phases == ["product-design"]

    def test_is_idempotent(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.skip_phase(t.id, "product-design")
        updated = svc.skip_phase(t.id, "product-design")
        assert updated.skipped_phases == ["product-design"]

    def test_current_advances_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.update_ticket(t.id, status="product-design")
        updated = svc.skip_phase(t.id, "product-design")
        assert updated.status == "technical-design"
        assert "product-design" in updated.skipped_phases

    def test_future_does_not_change_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.update_ticket(t.id, status="product-design")
        updated = svc.skip_phase(t.id, "technical-design")
        assert updated.status == "product-design"
        assert "technical-design" in updated.skipped_phases

    def test_past_does_not_change_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.update_ticket(t.id, status="product-design")
        svc.update_ticket(t.id, status="technical-design")
        updated = svc.skip_phase(t.id, "product-design")
        assert updated.status == "technical-design"
        assert "product-design" in updated.skipped_phases

    def test_rejects_idea(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        with pytest.raises(InvalidTransitionError):
            svc.skip_phase(t.id, "idea")

    def test_rejects_done(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        with pytest.raises(InvalidTransitionError):
            svc.skip_phase(t.id, "done")

    def test_persists_to_disk(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.skip_phase(t.id, "product-design")
        # Re-read from disk via a fresh BoardService instance (skip the
        # mkdir helper since .tr already exists from the first setup).
        svc2 = BoardService(load_config(tmp_path))
        reloaded = svc2.get_ticket(t.id)
        assert reloaded.skipped_phases == ["product-design"]


class TestUnskipPhase:
    def test_removes(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.skip_phase(t.id, "product-design")
        updated = svc.unskip_phase(t.id, "product-design")
        assert updated.skipped_phases == []

    def test_unknown_is_noop(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        updated = svc.unskip_phase(t.id, "product-design")
        assert updated.skipped_phases == []

    def test_does_not_change_status(self, tmp_path: Path) -> None:
        svc = _setup_board(tmp_path)
        t = svc.create_ticket("t")
        svc.skip_phase(t.id, "product-design")
        status_before = svc.get_ticket(t.id).status
        updated = svc.unskip_phase(t.id, "product-design")
        assert updated.status == status_before
