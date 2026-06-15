"""Integration tests for board/skipPhase and board/unskipPhase RPC handlers."""
from __future__ import annotations

from typing import Any

import pytest

from app.board.service import BoardService
from app.core.config import load_config
from app.rpc.methods.board import skip_phase, unskip_phase


def _unwrap(result: Any) -> Any:
    """Extract the payload from a jsonrpcserver Success(value)."""
    return result._value.result


def _board(tmp_path) -> BoardService:
    (tmp_path / ".tr").mkdir()
    return BoardService(load_config(tmp_path))


@pytest.mark.asyncio
async def test_rpc_skip_phase_calls_service(tmp_path) -> None:
    service = _board(tmp_path)
    ticket = service.create_ticket("t")
    result = _unwrap(
        await skip_phase(service, ticketId=ticket.id, phase="product-design")
    )
    assert result["id"] == ticket.id


@pytest.mark.asyncio
async def test_rpc_unskip_phase_calls_service(tmp_path) -> None:
    service = _board(tmp_path)
    ticket = service.create_ticket("t")
    await skip_phase(service, ticketId=ticket.id, phase="product-design")
    result = _unwrap(
        await unskip_phase(service, ticketId=ticket.id, phase="product-design")
    )
    assert result["id"] == ticket.id
