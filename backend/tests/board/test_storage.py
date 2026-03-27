from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.board.models import MetaTicket
from app.board.storage import (
    delete_ticket,
    list_tickets,
    read_ticket,
    ticket_path,
    write_ticket,
)


class TestTicketPath:
    def test_format(self, tmp_path: Path) -> None:
        p = ticket_path(tmp_path, "mt_abc12345")
        assert p == tmp_path / "mt_abc12345.json"


class TestWriteAndRead:
    def test_roundtrip(self, tmp_path: Path) -> None:
        t = MetaTicket(title="Test ticket", body="Description")
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)

        loaded = read_ticket(path)
        assert loaded.id == t.id
        assert loaded.title == "Test ticket"
        assert loaded.body == "Description"
        assert loaded.status == "idea"

    def test_json_format(self, tmp_path: Path) -> None:
        t = MetaTicket(title="Test", linked_spec_ids=["s1"])
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)

        raw = json.loads(path.read_text())
        assert "linkedSpecIds" in raw  # camelCase in JSON
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
            t = MetaTicket(title=f"Ticket {i}")
            write_ticket(ticket_path(tmp_path, t.id), t)
        tickets = list_tickets(tmp_path)
        assert len(tickets) == 3

    def test_skips_malformed(self, tmp_path: Path) -> None:
        t = MetaTicket(title="Good")
        write_ticket(ticket_path(tmp_path, t.id), t)
        (tmp_path / "bad.json").write_text("broken", encoding="utf-8")
        tickets = list_tickets(tmp_path)
        assert len(tickets) == 1


class TestDeleteTicket:
    def test_delete(self, tmp_path: Path) -> None:
        t = MetaTicket(title="Delete me")
        path = ticket_path(tmp_path, t.id)
        write_ticket(path, t)
        assert path.exists()
        delete_ticket(path)
        assert not path.exists()

    def test_delete_missing_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            delete_ticket(tmp_path / "nope.json")
