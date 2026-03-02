from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from jsonrpcserver import JsonRpcError

from app.agent.models import AgentTask
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError
import app.rpc.notifications as notifications
from app.rpc.methods.agents import (
    get_agent_status,
    interrupt_agent,
    list_agents,
    respond_agent,
    run_agent,
)


def _unwrap(result: Any) -> Any:
    """Extract the payload from a jsonrpcserver Success(value)."""
    return result._value.result


@pytest.fixture
def svc() -> MagicMock:
    return MagicMock()


class TestGetAgentStatus:
    async def test_returns_task(self, svc: MagicMock) -> None:
        task = AgentTask(id="t1", status="running", spec_ids=["s1"], session_id="sess-1")
        svc.get_task.return_value = task
        result = _unwrap(await get_agent_status(svc, taskId="t1"))
        assert result["id"] == "t1"
        assert result["status"] == "running"
        # Wire format uses camelCase
        assert result["specIds"] == ["s1"]
        assert result["sessionId"] == "sess-1"
        assert "spec_ids" not in result
        assert "session_id" not in result
        svc.get_task.assert_called_once_with("t1")

    async def test_not_found(self, svc: MagicMock) -> None:
        svc.get_task.side_effect = TaskNotFoundError("nope")
        with pytest.raises(JsonRpcError) as exc_info:
            await get_agent_status(svc, taskId="missing")
        assert exc_info.value.code == -32011

    async def test_missing_param(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await get_agent_status(svc)
        assert exc_info.value.code == -32602


class TestListAgents:
    async def test_returns_list(self, svc: MagicMock) -> None:
        svc.list_tasks.return_value = [
            AgentTask(id="t1", status="done", spec_ids=["s1"]),
            AgentTask(id="t2", status="running"),
        ]
        result = _unwrap(await list_agents(svc))
        assert len(result) == 2
        assert result[0]["id"] == "t1"
        assert result[1]["id"] == "t2"
        # Wire format uses camelCase
        assert result[0]["specIds"] == ["s1"]
        assert "spec_ids" not in result[0]

    async def test_empty(self, svc: MagicMock) -> None:
        svc.list_tasks.return_value = []
        result = _unwrap(await list_agents(svc))
        assert result == []


class TestRunAgent:
    async def test_returns_task_id(self, svc: MagicMock) -> None:
        task = AgentTask(id="t1")
        svc.run_task = AsyncMock(return_value=task)
        notifications.current_notify = AsyncMock()
        try:
            result = _unwrap(await run_agent(
                svc, specIds=["s1"], config={"model": "claude-sonnet-4-6"}
            ))
            assert result == {"taskId": "t1"}
            svc.run_task.assert_called_once()
            call_args = svc.run_task.call_args
            assert call_args[0][0] == ["s1"]
            assert call_args[0][2] is notifications.current_notify
        finally:
            notifications.current_notify = None

    async def test_no_connection(self, svc: MagicMock) -> None:
        notifications.current_notify = None
        with pytest.raises(JsonRpcError) as exc_info:
            await run_agent(svc, specIds=["s1"], config={})
        assert exc_info.value.code == -32603

    async def test_missing_params(self, svc: MagicMock) -> None:
        notifications.current_notify = AsyncMock()
        try:
            with pytest.raises(JsonRpcError) as exc_info:
                await run_agent(svc)
            assert exc_info.value.code == -32602
        finally:
            notifications.current_notify = None


class TestInterruptAgent:
    async def test_interrupts(self, svc: MagicMock) -> None:
        svc.interrupt_task = AsyncMock()
        await interrupt_agent(svc, taskId="t1")
        svc.interrupt_task.assert_called_once_with("t1")

    async def test_not_found(self, svc: MagicMock) -> None:
        svc.interrupt_task = AsyncMock(side_effect=TaskNotFoundError("nope"))
        with pytest.raises(JsonRpcError) as exc_info:
            await interrupt_agent(svc, taskId="missing")
        assert exc_info.value.code == -32011

    async def test_missing_param(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await interrupt_agent(svc)
        assert exc_info.value.code == -32602


class TestRespondAgent:
    async def test_responds(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock()
        response = {"behavior": "allow"}
        await respond_agent(svc, taskId="t1", requestId="r1", response=response)
        svc.respond.assert_called_once_with("t1", "r1", response)

    async def test_task_not_found(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock(side_effect=TaskNotFoundError("nope"))
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc, taskId="x", requestId="r1", response={})
        assert exc_info.value.code == -32011

    async def test_future_not_found(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock(side_effect=FutureNotFoundError("no future"))
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc, taskId="t1", requestId="bad", response={})
        assert exc_info.value.code == -32012

    async def test_missing_params(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc)
        assert exc_info.value.code == -32602


class TestErrorDecorator:
    async def test_future_not_found(self, svc: MagicMock) -> None:
        svc.get_task.side_effect = FutureNotFoundError("no future")
        with pytest.raises(JsonRpcError) as exc_info:
            await get_agent_status(svc, taskId="t1")
        assert exc_info.value.code == -32012

    async def test_internal_error(self, svc: MagicMock) -> None:
        svc.list_tasks.side_effect = RuntimeError("boom")
        with pytest.raises(JsonRpcError) as exc_info:
            await list_agents(svc)
        assert exc_info.value.code == -32603
