from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agent.models import AgentTask, SubsessionType
from app.rpc.methods.subsessions import (
    create_subsession,
    approve_summary,
    dismiss_summary,
)


def _unwrap(result):
    """Extract value from jsonrpcserver Success result."""
    return result._value.result


class TestCreateSubsession:
    async def test_creates_and_returns_bonsai_sid(self) -> None:
        svc = MagicMock()
        task = AgentTask(
            parent_bonsai_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            name="Discuss auth",
        )
        svc.create_subsession = AsyncMock(return_value=task)

        result = await create_subsession(
            svc,
            parentBonsaiSid="parent-1",
            type="discussion",
            name="Discuss auth",
        )

        data = _unwrap(result)
        assert data["bonsaiSid"] == task.bonsai_sid
        svc.create_subsession.assert_called_once_with(
            parent_bonsai_sid="parent-1",
            subsession_type=SubsessionType.discussion,
            context=None,
            name="Discuss auth",
        )


class TestApproveSummary:
    async def test_calls_service(self) -> None:
        svc = MagicMock()
        result = await approve_summary(svc, bonsaiSid="sub-1", text="Summary text")
        data = _unwrap(result)
        assert data == {"ok": True}
        svc.approve_summary.assert_called_once_with("sub-1", "Summary text")


class TestDismissSummary:
    async def test_calls_service(self) -> None:
        svc = MagicMock()
        result = await dismiss_summary(svc, bonsaiSid="sub-1")
        data = _unwrap(result)
        assert data == {"ok": True}
        svc.dismiss_summary.assert_called_once_with("sub-1")
