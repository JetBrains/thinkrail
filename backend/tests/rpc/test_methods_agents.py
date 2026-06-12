from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from jsonrpcserver import JsonRpcError

from app.agent.models import AgentTask
from app.agent.tracker import FutureNotFoundError, TaskNotFoundError
from app.rpc.methods.agents import (
    _MAX_DRAFT_INPUT,
    _validated_draft_input,
    _validated_sid,
    get_agent_status,
    interrupt_agent,
    list_agents,
    prepare_agent,
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
        task = AgentTask(thinkrail_sid="t1", status="running", spec_ids=["s1"], session_id="sess-1")
        svc.get_task.return_value = task
        result = _unwrap(await get_agent_status(svc, thinkrailSid="t1"))
        assert result["thinkrailSid"] == "t1"
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
            await get_agent_status(svc, thinkrailSid="missing")
        assert exc_info.value.code == -32011

    async def test_missing_param(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await get_agent_status(svc)
        assert exc_info.value.code == -32602


class TestListAgents:
    async def test_returns_list(self, svc: MagicMock) -> None:
        svc.list_tasks.return_value = [
            AgentTask(thinkrail_sid="t1", status="done", spec_ids=["s1"]),
            AgentTask(thinkrail_sid="t2", status="running"),
        ]
        result = _unwrap(await list_agents(svc))
        assert len(result) == 2
        assert result[0]["thinkrailSid"] == "t1"
        assert result[1]["thinkrailSid"] == "t2"
        # Wire format uses camelCase
        assert result[0]["specIds"] == ["s1"]
        assert "spec_ids" not in result[0]

    async def test_empty(self, svc: MagicMock) -> None:
        svc.list_tasks.return_value = []
        result = _unwrap(await list_agents(svc))
        assert result == []


class TestRunAgent:
    async def test_returns_task_id(self, svc: MagicMock) -> None:
        task = AgentTask(thinkrail_sid="t1")
        svc.run_task = AsyncMock(return_value=task)
        result = _unwrap(await run_agent(
            svc, specIds=["s1"], config={"model": "claude-sonnet-4-6"}
        ))
        assert result == {"thinkrailSid": "t1"}
        svc.run_task.assert_called_once()
        call_args = svc.run_task.call_args
        assert call_args[0][0] == ["s1"]

    async def test_missing_params(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await run_agent(svc)
        assert exc_info.value.code == -32602

    async def test_publishes_did_create(self, svc: MagicMock) -> None:
        # SuggestSession-approve goes through agent/run; without this
        # publish, the sidebar SessionManager never refreshes for the
        # newly-created session until the user hits ↻.
        task = AgentTask(thinkrail_sid="t-run", spec_ids=["s1"], name="Suggested")
        svc.run_task = AsyncMock(return_value=task)
        conn = MagicMock(display_name="Alice", project_path="/proj")
        bus_mock = MagicMock()
        bus_mock.publish_to_project = AsyncMock()
        with (
            patch("app.rpc.methods.agents.get_current_conn", return_value=conn),
            patch("app.rpc.methods.agents.bus", bus_mock),
            patch("app.rpc.methods.agents.auto_subscribe_all"),
        ):
            await run_agent(svc, specIds=["s1"], config={"model": "claude-sonnet-4-6"})
        bus_mock.publish_to_project.assert_awaited_once()
        call_args = bus_mock.publish_to_project.call_args
        assert call_args.args[0] == "/proj"
        assert call_args.args[1] == "session/didCreate"
        payload = call_args.args[2]
        assert payload["thinkrailSid"] == "t-run"
        assert payload["name"] == "Suggested"
        assert payload["createdBy"] == "Alice"


class TestInterruptAgent:
    async def test_interrupts(self, svc: MagicMock) -> None:
        svc.interrupt_task = AsyncMock()
        await interrupt_agent(svc, thinkrailSid="t1")
        svc.interrupt_task.assert_called_once_with("t1")

    async def test_not_found(self, svc: MagicMock) -> None:
        svc.interrupt_task = AsyncMock(side_effect=TaskNotFoundError("nope"))
        with pytest.raises(JsonRpcError) as exc_info:
            await interrupt_agent(svc, thinkrailSid="missing")
        assert exc_info.value.code == -32011

    async def test_missing_param(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await interrupt_agent(svc)
        assert exc_info.value.code == -32602


class TestRespondAgent:
    async def test_responds(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock()
        response = {"behavior": "allow"}
        await respond_agent(svc, thinkrailSid="t1", requestId="r1", response=response)
        svc.respond.assert_called_once_with("t1", "r1", response)

    async def test_task_not_found(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock(side_effect=TaskNotFoundError("nope"))
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc, thinkrailSid="x", requestId="r1", response={})
        assert exc_info.value.code == -32011

    async def test_future_not_found(self, svc: MagicMock) -> None:
        svc.respond = AsyncMock(side_effect=FutureNotFoundError("no future"))
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc, thinkrailSid="t1", requestId="bad", response={})
        assert exc_info.value.code == -32012

    async def test_missing_params(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await respond_agent(svc)
        assert exc_info.value.code == -32602


class TestErrorDecorator:
    async def test_future_not_found(self, svc: MagicMock) -> None:
        svc.get_task.side_effect = FutureNotFoundError("no future")
        with pytest.raises(JsonRpcError) as exc_info:
            await get_agent_status(svc, thinkrailSid="t1")
        assert exc_info.value.code == -32012

    async def test_internal_error(self, svc: MagicMock) -> None:
        svc.list_tasks.side_effect = RuntimeError("boom")
        with pytest.raises(JsonRpcError) as exc_info:
            await list_agents(svc)
        assert exc_info.value.code == -32603


class TestDraftOnTypeValidation:
    def test_validated_sid_accepts_uuid(self) -> None:
        import uuid

        u = str(uuid.uuid4())
        assert _validated_sid(u) == u

    def test_validated_sid_none_passes_through(self) -> None:
        assert _validated_sid(None) is None

    @pytest.mark.parametrize("bad", ["../../etc/passwd", "a/b", "not-a-uuid", "..", ""])
    def test_validated_sid_rejects_non_uuid(self, bad: str) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            _validated_sid(bad)
        assert exc_info.value.code == -32602

    def test_validated_draft_input_allows_normal(self) -> None:
        assert _validated_draft_input("hello") == "hello"
        assert _validated_draft_input(None) is None

    def test_validated_draft_input_rejects_oversized(self) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            _validated_draft_input("x" * (_MAX_DRAFT_INPUT + 1))
        assert exc_info.value.code == -32602

    async def test_prepare_agent_rejects_traversal_sid(self, svc: MagicMock) -> None:
        with pytest.raises(JsonRpcError) as exc_info:
            await prepare_agent(svc, specIds=[], config={}, thinkrailSid="../../evil")
        assert exc_info.value.code == -32602
        svc.prepare_task.assert_not_called()
