from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from app.board.models import OrchestratorRef, Ticket
from app.rpc.methods.sessions import promote_to_ticket, restart_session


def _unwrap(result):
    """Extract value from jsonrpcserver Success result."""
    return result._value.result


class TestRestartSession:
    async def test_subscribes_after_restart_not_before(self) -> None:
        """The conn must be re-subscribed AFTER the restart completes. Ending
        the old session runs ``bus.cleanup_topic("session:<sid>")``, which wipes
        the topic's subscribers — so subscribing before the restart (the obvious
        order) leaves the relaunched session with no live event delivery until a
        page reload. Lock the order."""
        order: list[str] = []
        svc = MagicMock()
        task = MagicMock()
        task.thinkrail_sid = "sid-1"

        async def _restart(sid: str):
            order.append("restart")
            return task

        svc.restart_session = AsyncMock(side_effect=_restart)

        with patch(
            "app.rpc.methods.sessions.auto_subscribe_all",
            side_effect=lambda sid: order.append("subscribe"),
        ):
            result = await restart_session(svc, thinkrailSid="sid-1")

        assert order == ["restart", "subscribe"]
        assert _unwrap(result)["thinkrailSid"] == "sid-1"


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
