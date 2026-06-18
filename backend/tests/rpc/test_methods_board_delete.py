"""Integration test: the board/delete RPC handler broadcasts ``board/didDelete``."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.board.service import BoardService, TicketNotFoundError
from app.core.config import load_config
from app.rpc.methods.board import delete_ticket


def _board(tmp_path) -> BoardService:
    (tmp_path / ".tr").mkdir()
    return BoardService(load_config(tmp_path))


@pytest.mark.asyncio
async def test_delete_ticket_broadcasts_did_delete(tmp_path) -> None:
    service = _board(tmp_path)
    ticket = service.create_ticket("t")

    conn = MagicMock()
    conn.project_path = str(tmp_path)
    bus_mock = MagicMock()
    bus_mock.publish_to_project = AsyncMock()

    with (
        patch("app.rpc.methods.board.get_current_conn", return_value=conn),
        patch("app.rpc.methods.board.bus", bus_mock),
    ):
        await delete_ticket(service, id=ticket.id)

    bus_mock.publish_to_project.assert_awaited_once()
    _project, method, payload = bus_mock.publish_to_project.call_args.args
    assert method == "board/didDelete"
    assert payload == {"id": ticket.id}
    with pytest.raises(TicketNotFoundError):
        service.get_ticket(ticket.id)
