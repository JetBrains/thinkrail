from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from app.board.models import OrchestratorRef, Ticket
from app.rpc.methods.sessions import promote_to_ticket


def _unwrap(result):
    """Extract value from jsonrpcserver Success result."""
    return result._value.result


class TestPromoteToTicket:
    async def test_calls_service_and_returns_ticket_dict(self) -> None:
        svc = MagicMock()
        ticket = Ticket(title="My feature")
        ticket.orchestrator = OrchestratorRef(kind="session", session_id="sid-1")
        svc.promote_to_ticket = AsyncMock(return_value=ticket)

        result = await promote_to_ticket(
            svc,
            thinkrailSid="sid-1",
            title="My feature",
        )

        data = _unwrap(result)
        assert data["title"] == "My feature"
        assert data["orchestrator"]["sessionId"] == "sid-1"
        svc.promote_to_ticket.assert_called_once_with(
            "sid-1", title="My feature", body="", type="feature",
        )

    async def test_passes_optional_body_and_type(self) -> None:
        svc = MagicMock()
        ticket = Ticket(title="Bug fix", type="bug")
        svc.promote_to_ticket = AsyncMock(return_value=ticket)

        await promote_to_ticket(
            svc,
            thinkrailSid="sid-2",
            title="Bug fix",
            body="Some context",
            type="bug",
        )

        svc.promote_to_ticket.assert_called_once_with(
            "sid-2", title="Bug fix", body="Some context", type="bug",
        )
