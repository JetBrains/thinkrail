from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.board.models import Ticket
from app.board.storage import (
    delete_ticket,
    list_tickets,
    read_ticket,
    ticket_path,
    tickets_root,
    wipe_legacy_meta_tickets,
    write_ticket,
)


class TestTicketPath:
    def test_format(self, tmp_path: Path) -> None:
        p = ticket_path(tmp_path, "mt_abc12345")
        assert p == tmp_path / "mt_abc12345" / "ticket.json"


class TestWriteAndRead:
    def test_roundtrip(self, tmp_path: Path) -> None:
        t = Ticket(title="Test ticket", body="Description")
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)

        loaded = read_ticket(path)
        assert loaded.id == t.id
        assert loaded.title == "Test ticket"
        assert loaded.body == "Description"
        assert loaded.status == "idea"

    def test_json_format(self, tmp_path: Path) -> None:
        t = Ticket(title="Test", linked_spec_ids=["s1"])
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)

        raw = json.loads(path.read_text())
        assert "linkedSpecIds" in raw
        assert raw["linkedSpecIds"] == ["s1"]

    def test_read_missing_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            read_ticket(tmp_path / "nonexistent.json")

    def test_read_malformed_raises(self, tmp_path: Path) -> None:
        path = tmp_path / "bad.json"
        path.write_text("not json", encoding="utf-8")
        with pytest.raises(ValueError, match="Malformed"):
            read_ticket(path)


class TestListTickets:
    def test_empty_dir(self, tmp_path: Path) -> None:
        assert list_tickets(tmp_path) == []

    def test_nonexistent_dir(self, tmp_path: Path) -> None:
        assert list_tickets(tmp_path / "nope") == []

    def test_reads_all(self, tmp_path: Path) -> None:
        for i in range(3):
            t = Ticket(title=f"Ticket {i}")
            write_ticket(ticket_path(tmp_path, t.id), t)
        tickets = list_tickets(tmp_path)
        assert len(tickets) == 3

    def test_skips_malformed(self, tmp_path: Path) -> None:
        t = Ticket(title="Good")
        write_ticket(ticket_path(tmp_path, t.id), t)
        # Malformed: folder with bad ticket.json
        bad = tmp_path / "mt_bad"
        bad.mkdir()
        (bad / "ticket.json").write_text("broken", encoding="utf-8")
        tickets = list_tickets(tmp_path)
        assert len(tickets) == 1
        assert tickets[0].id == t.id


class TestMigration:
    def test_old_legacy_fields_dropped(self, tmp_path: Path) -> None:
        """Tickets with legacy fields load successfully — fields are ignored."""
        data = {
            "id": "mt_old1",
            "title": "Legacy ticket",
            "status": "idea",
            "type": "feature",
            "linkedSpecIds": [],
            "sessionIds": [],
            "specChanges": [{"specId": "x", "specTitle": "X", "changeType": "created",
                             "summary": "s", "sectionsChanged": [], "detail": "", "sessionId": ""}],
            "specPatches": [],
            "designDocPath": "x",
            "planPath": "y",
            "designDocStale": True,
            "planStale": True,
            "ticketDir": ".tr/tickets/mt_old1",
            "order": 0,
            "created": "2026-01-01T00:00:00+00:00",
            "updated": "2026-01-01T00:00:00+00:00",
        }
        folder = tmp_path / "mt_old1"
        folder.mkdir(parents=True)
        path = folder / "ticket.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        ticket = read_ticket(path)
        assert ticket.id == "mt_old1"
        assert not hasattr(ticket, "spec_patches")
        assert not hasattr(ticket, "design_doc_path")
        assert not hasattr(ticket, "plan_path")
        assert not hasattr(ticket, "ticket_dir")
        assert ticket.title == "Legacy ticket"


class TestLegacyTicketsWipe:
    def test_wipe_skips_non_empty_directory(self, tmp_path: Path) -> None:
        legacy = tmp_path / ".tr" / "meta-tickets"
        legacy.mkdir(parents=True)
        (legacy / "mt_old.json").write_text('{"id": "mt_old", "title": "x"}')
        # Refuses to delete user content from the previous schema.
        assert wipe_legacy_meta_tickets(tmp_path) is False
        assert (legacy / "mt_old.json").is_file()

    def test_wipe_removes_empty_directory(self, tmp_path: Path) -> None:
        legacy = tmp_path / ".tr" / "meta-tickets"
        legacy.mkdir(parents=True)
        assert wipe_legacy_meta_tickets(tmp_path) is True
        assert not legacy.exists()

    def test_wipe_noop_when_missing(self, tmp_path: Path) -> None:
        (tmp_path / ".tr").mkdir()
        assert wipe_legacy_meta_tickets(tmp_path) is False


class TestReadTicketReconciliation:
    """When an agent writes artifact files directly via Write (not the backend's
    write_artifact), ticket.json's bookkeeping fields stay null/empty. read_ticket
    must reconcile derivable state with disk truth on every load."""

    def _seed_ticket(self, folder: Path, ticket_id: str, body: str = "") -> Path:
        folder.mkdir(parents=True)
        meta = folder / "ticket.json"
        meta.write_text(json.dumps({
            "id": ticket_id,
            "title": "Test",
            "body": body,
            "status": "product-design",
            "type": "feature",
            "productDesignPath": None,
            "technicalDesignPath": None,
            "historyPath": None,
            "implementationPlanPath": None,
            "linkedSpecIds": [],
            "sessionIds": [],
            "order": 0,
            "created": "2026-05-21T00:00:00+00:00",
            "updated": "2026-05-21T00:00:00+00:00",
        }))
        return meta

    def test_existing_product_design_md_populates_path(self, tmp_path: Path) -> None:
        folder = tmp_path / "mt_a"
        meta = self._seed_ticket(folder, "mt_a")
        (folder / "product-design.md").write_text("# Product design\n\nDoes X for Y.\n")

        ticket = read_ticket(meta)

        assert ticket.product_design_path == ".tr/tickets/mt_a/product-design.md"

    def test_existing_product_design_md_autofills_empty_body(self, tmp_path: Path) -> None:
        folder = tmp_path / "mt_b"
        meta = self._seed_ticket(folder, "mt_b", body="")
        md = (
            "---\n"
            "ticket_id: mt_b\n"
            "kind: product_design\n"
            "---\n\n"
            "# Product design: Test\n\n"
            "This feature does X for Y users.\n"
            "\n"
            "## Goal\n\n"
            "More detail here.\n"
        )
        (folder / "product-design.md").write_text(md)

        ticket = read_ticket(meta)

        assert ticket.body.startswith("This feature does X for Y users")

    def test_non_empty_body_is_preserved(self, tmp_path: Path) -> None:
        folder = tmp_path / "mt_c"
        meta = self._seed_ticket(folder, "mt_c", body="Pre-existing body")
        (folder / "product-design.md").write_text("# Title\n\nNew paragraph.\n")

        ticket = read_ticket(meta)

        assert ticket.body == "Pre-existing body"

    def test_reconciliation_persists_to_disk(self, tmp_path: Path) -> None:
        """Reconciled state is written back, so subsequent reads are no-ops."""
        folder = tmp_path / "mt_d"
        meta = self._seed_ticket(folder, "mt_d")
        (folder / "product-design.md").write_text("# Title\n\nFirst paragraph here.\n")

        read_ticket(meta)

        # ticket.json should now have the path persisted
        raw = json.loads(meta.read_text())
        assert raw["productDesignPath"] == ".tr/tickets/mt_d/product-design.md"
        assert raw["body"].startswith("First paragraph here")

    def test_missing_file_clears_stale_path(self, tmp_path: Path) -> None:
        """If ticket.json says path is set but file is gone, reconcile to null."""
        folder = tmp_path / "mt_e"
        folder.mkdir(parents=True)
        meta = folder / "ticket.json"
        meta.write_text(json.dumps({
            "id": "mt_e",
            "title": "Test",
            "body": "",
            "status": "product-design",
            "type": "feature",
            "productDesignPath": ".tr/tickets/mt_e/product-design.md",
            "linkedSpecIds": [],
            "sessionIds": [],
            "order": 0,
            "created": "x",
            "updated": "y",
        }))

        ticket = read_ticket(meta)

        assert ticket.product_design_path is None


class TestListTicketsNewLayout:
    def test_skips_folders_without_ticket_json(self, tmp_path: Path) -> None:
        base = tmp_path / ".tr" / "tickets"
        base.mkdir(parents=True)
        # Folder with ticket.json
        good = base / "mt_a"
        good.mkdir()
        (good / "ticket.json").write_text(json.dumps({
            "id": "mt_a", "title": "valid", "status": "idea", "type": "feature",
            "linkedSpecIds": [], "sessionIds": [],
            "order": 0, "created": "x", "updated": "y",
        }))
        # Folder without ticket.json (artifact-only)
        orphan = base / "mt_orphan"
        orphan.mkdir()
        (orphan / "product-design.md").write_text("# orphan")

        tickets = list_tickets(base)
        ids = [t.id for t in tickets]
        assert "mt_a" in ids
        assert "mt_orphan" not in ids


class TestTicketsRoot:
    def test_returns_under_thinkrail(self, tmp_path: Path) -> None:
        assert tickets_root(tmp_path) == tmp_path / ".tr" / "tickets"


class TestDeleteTicket:
    def test_delete(self, tmp_path: Path) -> None:
        t = Ticket(title="Delete me")
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)
        assert path.exists()
        delete_ticket(path)
        assert not path.exists()

    def test_delete_missing_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            delete_ticket(tmp_path / "nope.json")
