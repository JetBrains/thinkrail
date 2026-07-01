from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import load_config
from app.board.service import BoardService
from app.board.work_node import DagError
import app.agent.tools.orchestration as orch


class TestApplyAndEmit:
    def test_propose_pipeline_writes_stages(self, tmp_path: Path):
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()) as pub,
        ):
            result = asyncio.run(orch._apply_and_emit({
                "op": "proposePipeline",
                "nodes": [
                    {"id": "pd", "title": "Product design", "skill": "ticket-product-design"},
                    {"id": "impl", "title": "Implementing", "skill": "ticket-implement",
                     "executesPlan": True, "dependsOn": ["pd"]},
                ],
            }))

        assert "isError" not in result
        reread = board.get_ticket(ticket.id)
        assert [n.id for n in reread.stages] == ["pd", "impl"]
        pub.assert_awaited_once()

    def test_unlinked_session_errors(self, tmp_path: Path):
        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = None
        with patch.object(orch, "get_tool_context", return_value=ctx):
            result = asyncio.run(orch._apply_and_emit({"op": "addNode",
                                                       "node": {"id": "a", "title": "A"}}))
        assert result["isError"] is True


class TestStartNodeImplementingBranch:
    def test_spawns_session_and_records_run(self, tmp_path):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock, patch
        from pathlib import Path
        from app.core.config import load_config
        from app.board.service import BoardService

        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "addNode", "node": {
            "id": "impl", "title": "Implementing", "skill": "ticket-implement",
            "executesPlan": True}})
        board.apply(ticket.id, {"op": "setOrchestration", "config": {"stageGate": "autonomous"}})

        agent = MagicMock()
        agent.run_task = AsyncMock(return_value=MagicMock(thinkrail_sid="child-sid"))
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            result = asyncio.run(orch._start_node.handler({"id": "impl"})) \
                if hasattr(orch._start_node, "handler") \
                else asyncio.run(orch._start_node({"id": "impl"}))

        assert "isError" not in result
        agent.run_task.assert_awaited_once()
        impl = next(n for n in board.get_ticket(ticket.id).stages if n.id == "impl")
        assert impl.runs and impl.runs[-1].kind == "session"
        assert impl.runs[-1].session_id == "child-sid"


class TestStartNodeSubagentMode:
    """start_node on an executes_plan node must forward the ticket's
    step_execution setting as subagent_mode to run_task."""

    def _setup(self, tmp_path: Path, step_execution: str = "subagent") -> tuple:
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "addNode", "node": {
            "id": "impl", "title": "Implementing", "skill": "ticket-implement",
            "executesPlan": True,
        }})
        board.apply(ticket.id, {"op": "setOrchestration",
                                 "config": {"stepExecution": step_execution, "stageGate": "autonomous"}})
        return board, ticket

    def test_executes_plan_node_passes_subagent_mode_subagent(self, tmp_path):
        board, ticket = self._setup(tmp_path, step_execution="subagent")
        calls: list[dict] = []

        async def fake_run_task(**kwargs):
            calls.append(kwargs)
            return MagicMock(thinkrail_sid="impl-sid")

        agent = MagicMock()
        agent.run_task = fake_run_task
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            result = asyncio.run(orch._start_node.handler({"id": "impl"})) \
                if hasattr(orch._start_node, "handler") \
                else asyncio.run(orch._start_node({"id": "impl"}))

        assert "isError" not in result
        assert calls, "run_task was not called"
        assert calls[0].get("subagent_mode") == "subagent", (
            f"Expected subagent_mode='subagent', got: {calls[0]}"
        )

    def test_executes_plan_node_passes_subagent_mode_step_session_when_interactive(
        self, tmp_path
    ):
        board, ticket = self._setup(tmp_path, step_execution="interactive")
        calls: list[dict] = []

        async def fake_run_task(**kwargs):
            calls.append(kwargs)
            return MagicMock(thinkrail_sid="impl-sid")

        agent = MagicMock()
        agent.run_task = fake_run_task
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            result = asyncio.run(orch._start_node.handler({"id": "impl"})) \
                if hasattr(orch._start_node, "handler") \
                else asyncio.run(orch._start_node({"id": "impl"}))

        assert "isError" not in result
        assert calls, "run_task was not called"
        assert calls[0].get("subagent_mode") == "step-session", (
            f"Expected subagent_mode='step-session', got: {calls[0]}"
        )


class TestStartNodeStageGate:
    """start_node handler owns the stage gate and fires in all permission modes."""

    def _setup(self, tmp_path: Path, stage_gate: str = "approve") -> tuple:
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "addNode", "node": {
            "id": "pd", "title": "Product design", "skill": "ticket-product-design",
        }})
        board.apply(ticket.id, {"op": "setOrchestration",
                                 "config": {"stageGate": stage_gate}})
        agent = MagicMock()
        agent.run_task = AsyncMock(return_value=MagicMock(thinkrail_sid="sess-pd"))
        agent.send_message = AsyncMock()
        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.skill_id = "ticket-orchestrator"  # so the real stage gate resolves
        ctx.task.config = MagicMock()
        ctx.agent_service = agent
        return board, ticket, agent, ctx

    def _run(self, board, ctx, node_id: str = "pd") -> dict:
        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            fn = orch._start_node.handler if hasattr(orch._start_node, "handler") else orch._start_node
            return asyncio.run(fn({"id": node_id}))

    def test_approve_gate_allow_launches_session(self, tmp_path):
        # Real gate: ticket stageGate="approve" + orchestrator skill → must await.
        board, ticket, agent, ctx = self._setup(tmp_path, stage_gate="approve")
        await_mock = AsyncMock(return_value=({"behavior": "allow"}, "rid"))
        with patch("app.agent.permissions._await_user_response", new=await_mock):
            result = self._run(board, ctx)
        assert "isError" not in result
        await_mock.assert_awaited_once()   # the gate actually fired
        agent.run_task.assert_awaited_once()

    def test_approve_gate_deny_returns_error_without_launching(self, tmp_path):
        board, ticket, agent, ctx = self._setup(tmp_path, stage_gate="approve")
        with patch("app.agent.permissions._await_user_response",
                   new=AsyncMock(return_value=({"behavior": "deny"}, "rid"))):
            result = self._run(board, ctx)
        assert result.get("isError") is True
        assert "declined" in result["content"][0]["text"]
        agent.run_task.assert_not_awaited()

    def test_autonomous_gate_launches_without_await(self, tmp_path):
        board, ticket, agent, ctx = self._setup(tmp_path, stage_gate="autonomous")
        await_mock = AsyncMock(return_value=({"behavior": "allow"}, "rid"))
        with patch("app.agent.permissions._await_user_response", new=await_mock):
            result = self._run(board, ctx)
        assert "isError" not in result
        agent.run_task.assert_awaited_once()
        await_mock.assert_not_awaited()   # autonomous → no confirmation prompt


class TestStartNode:
    def test_spawns_session_for_non_implementing_node(self, tmp_path):
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "addNode", "node": {
            "id": "pd", "title": "Product design", "skill": "ticket-product-design"}})
        board.apply(ticket.id, {"op": "setOrchestration", "config": {"stageGate": "autonomous"}})

        calls: list[dict] = []

        async def fake_run_task(**kwargs):
            calls.append(kwargs)
            return MagicMock(thinkrail_sid="sess-pd")

        agent = MagicMock()
        agent.run_task = fake_run_task
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            result = asyncio.run(orch._start_node.handler({"id": "pd"})) \
                if hasattr(orch._start_node, "handler") \
                else asyncio.run(orch._start_node({"id": "pd"}))

        assert "isError" not in result
        assert calls, "run_task was not called"
        assert calls[0]["skill_id"] == "ticket-product-design"
        reloaded = board.get_ticket(ticket.id)
        pd_node = next(n for n in reloaded.stages if n.id == "pd")
        assert pd_node.runs and pd_node.runs[-1].kind == "session"
        assert pd_node.runs[-1].session_id == "sess-pd"
        assert pd_node.status == "running"
        assert "pd" in result["content"][0]["text"]


class TestStartNodeDependencyGuard:
    """_start_node must refuse to launch a node whose dependencies are not done."""

    def _setup(self, tmp_path: Path, dep_status: str) -> tuple:
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "proposePipeline", "nodes": [
            {"id": "a", "title": "Stage A", "skill": "ticket-product-design"},
            {"id": "b", "title": "Stage B", "skill": "ticket-product-design",
             "dependsOn": ["a"]},
        ]})
        if dep_status == "done":
            board.apply(ticket.id, {"op": "recordRunStart", "id": "a",
                                     "run": {"kind": "session", "sessionId": "s-a",
                                             "status": "running"}})
            board.apply(ticket.id, {"op": "recordRunFinish", "id": "a",
                                     "summary": "ok", "completedAt": "2026-01-01T00:00:00Z"})
        calls: list[dict] = []

        async def fake_run_task(**kwargs):
            calls.append(kwargs)
            return MagicMock(thinkrail_sid="sess-b")

        agent = MagicMock()
        agent.run_task = fake_run_task
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent
        return board, ticket, agent, calls, ctx

    def _run(self, board, ctx, node_id: str = "b") -> dict:
        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
            patch("app.agent.permissions._gate_for_tool", return_value="autonomous"),
        ):
            fn = orch._start_node.handler if hasattr(orch._start_node, "handler") else orch._start_node
            return asyncio.run(fn({"id": node_id}))

    def test_returns_error_when_dep_not_done(self, tmp_path):
        board, ticket, agent, calls, ctx = self._setup(tmp_path, dep_status="pending")
        result = self._run(board, ctx)
        assert result.get("isError") is True
        assert "not ready" in result["content"][0]["text"]
        assert "a" in result["content"][0]["text"]
        assert not calls, "run_task must not be called when dep is unfinished"

    def test_launches_when_dep_is_done(self, tmp_path):
        board, ticket, agent, calls, ctx = self._setup(tmp_path, dep_status="done")
        result = self._run(board, ctx)
        assert "isError" not in result
        assert calls, "run_task should be called when all deps are done"


class TestStartNodeKickoffMessage:
    """Regression guard for #57. The kick-off message for the implementing
    node must orient the child at the plan-step model (its skill + injected
    mode instructions), never the retired node-DAG step vocabulary
    (``propose_children`` / ``start_node`` / "Agent for subagent steps").
    """

    def _launch_message(self, tmp_path: Path, *, executes_plan: bool) -> str:
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        if executes_plan:
            node = {"id": "impl", "title": "Implementing",
                    "skill": "ticket-implement", "executesPlan": True}
            node_id = "impl"
        else:
            node = {"id": "pd", "title": "Product design",
                    "skill": "ticket-product-design"}
            node_id = "pd"
        board.apply(ticket.id, {"op": "addNode", "node": node})
        board.apply(ticket.id, {"op": "setOrchestration",
                                 "config": {"stageGate": "autonomous"}})

        agent = MagicMock()
        agent.run_task = AsyncMock(return_value=MagicMock(thinkrail_sid="child"))
        agent.send_message = AsyncMock()

        ctx = MagicMock()
        ctx.notify = AsyncMock()
        ctx.config = load_config(tmp_path)
        ctx.task.ticket_id = ticket.id
        ctx.task.config = MagicMock()
        ctx.agent_service = agent

        with (
            patch.object(orch, "get_tool_context", return_value=ctx),
            patch.object(orch, "BoardService", return_value=board),
            patch.object(orch, "publish_ticket_state", new=AsyncMock()),
        ):
            fn = orch._start_node.handler if hasattr(orch._start_node, "handler") else orch._start_node
            asyncio.run(fn({"id": node_id}))

        agent.send_message.assert_awaited_once()
        return agent.send_message.call_args.args[1]

    def test_implementing_message_drops_node_dag_step_vocabulary(self, tmp_path):
        msg = self._launch_message(tmp_path, executes_plan=True)
        assert "propose_children" not in msg
        assert "start_node" not in msg
        assert "step children" not in msg
        # It should orient the child as the plan orchestrator.
        assert "plan" in msg.lower()
        assert "SessionFinalize" in msg

    def test_regular_stage_message_still_tells_the_session_to_do_the_work(self, tmp_path):
        msg = self._launch_message(tmp_path, executes_plan=False)
        assert "do the work" in msg
        assert "propose_children" not in msg


class TestProposeChildrenRetired:
    """#57 reconciliation: the vestigial node-DAG-for-steps entry points are
    gone. Steps live in the plan (``suggest_step`` / ``Agent``), not as
    ``WorkNode`` children, so ``propose_children`` is no longer a tool or op.
    """

    def test_propose_children_op_is_unknown(self, tmp_path):
        (tmp_path / ".tr").mkdir(exist_ok=True)
        board = BoardService(load_config(tmp_path))
        ticket = board.create_ticket(title="T")
        board.apply(ticket.id, {"op": "addNode", "node": {"id": "impl", "title": "I"}})
        with pytest.raises(DagError):
            board.apply(ticket.id,
                        {"op": "proposeChildren", "parentId": "impl", "nodes": []})

    def test_propose_children_not_registered_as_tool(self):
        from app.agent.permissions import _INTERCEPTOR_CATEGORIES
        from app.agent.tools import INTERCEPTORS
        assert "propose_children" not in _INTERCEPTOR_CATEGORIES
        assert "propose_children" not in INTERCEPTORS
