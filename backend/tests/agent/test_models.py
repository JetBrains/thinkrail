from __future__ import annotations

from app.agent.models import (
    AgentConfig,
    AgentEvent,
    AgentResult,
    AgentTask,
    AskUserQuestionResponse,
    Question,
    QuestionOption,
    ToolApprovalResponse,
)


class TestAgentConfig:
    def test_defaults(self) -> None:
        cfg = AgentConfig()
        assert cfg.model == "claude-sonnet-4-6"
        assert cfg.max_turns == 25
        assert cfg.permission_mode == "default"
        assert cfg.stream_text is True

    def test_custom_values(self) -> None:
        cfg = AgentConfig(model="claude-opus-4-6", max_turns=10, permission_mode="strict", stream_text=False)
        assert cfg.model == "claude-opus-4-6"
        assert cfg.max_turns == 10
        assert cfg.stream_text is False

    def test_serialization_round_trip(self) -> None:
        cfg = AgentConfig(model="claude-haiku-4-5-20251001", max_turns=5)
        data = cfg.model_dump()
        restored = AgentConfig(**data)
        assert restored == cfg


class TestAgentTask:
    def test_defaults(self) -> None:
        task = AgentTask()
        assert len(task.id) > 0
        assert task.status == "pending"
        assert task.spec_ids == []
        assert task.session_id is None
        assert task.created != ""
        assert task.updated != ""

    def test_unique_ids(self) -> None:
        t1 = AgentTask()
        t2 = AgentTask()
        assert t1.id != t2.id

    def test_custom_values(self) -> None:
        cfg = AgentConfig(model="claude-opus-4-6")
        task = AgentTask(
            id="test-id",
            status="running",
            spec_ids=["spec-1", "spec-2"],
            config=cfg,
            session_id="sess-1",
        )
        assert task.id == "test-id"
        assert task.status == "running"
        assert task.spec_ids == ["spec-1", "spec-2"]
        assert task.config.model == "claude-opus-4-6"
        assert task.session_id == "sess-1"

    def test_serialization_round_trip(self) -> None:
        task = AgentTask(spec_ids=["s1"])
        data = task.model_dump()
        restored = AgentTask(**data)
        assert restored.id == task.id
        assert restored.spec_ids == ["s1"]


class TestAgentEvent:
    def test_construction(self) -> None:
        event = AgentEvent(
            task_id="t1",
            session_id="s1",
            event_type="text_delta",
            payload={"text": "hello"},
        )
        assert event.task_id == "t1"
        assert event.event_type == "text_delta"
        assert event.payload == {"text": "hello"}

    def test_default_payload(self) -> None:
        event = AgentEvent(task_id="t1", session_id="s1", event_type="done")
        assert event.payload == {}

    def test_serialization(self) -> None:
        event = AgentEvent(
            task_id="t1",
            session_id="s1",
            event_type="session_start",
            payload={"session_id": "s1"},
        )
        data = event.model_dump()
        assert data["event_type"] == "session_start"
        assert data["payload"]["session_id"] == "s1"


class TestAgentResult:
    def test_construction(self) -> None:
        result = AgentResult(
            task_id="t1",
            session_id="s1",
            result="Task completed",
            cost_usd=0.05,
            turns=3,
            duration_ms=12000,
            usage={"input_tokens": 100, "output_tokens": 200},
        )
        assert result.cost_usd == 0.05
        assert result.turns == 3
        assert result.duration_ms == 12000
        assert result.usage["input_tokens"] == 100

    def test_default_usage(self) -> None:
        result = AgentResult(
            task_id="t1",
            session_id="s1",
            result="done",
            cost_usd=0.0,
            turns=1,
            duration_ms=500,
        )
        assert result.usage == {}


class TestInteractiveModels:
    def test_question_option(self) -> None:
        opt = QuestionOption(label="Yes", description="Approve the action")
        assert opt.label == "Yes"
        assert opt.description == "Approve the action"

    def test_question(self) -> None:
        opts = [
            QuestionOption(label="A", description="Option A"),
            QuestionOption(label="B", description="Option B"),
        ]
        q = Question(question="Pick one?", header="Choice", options=opts)
        assert q.question == "Pick one?"
        assert q.multi_select is False
        assert len(q.options) == 2

    def test_question_multi_select(self) -> None:
        opts = [QuestionOption(label="X", description="x")]
        q = Question(question="Select", header="H", options=opts, multi_select=True)
        assert q.multi_select is True

    def test_ask_user_question_response(self) -> None:
        opts = [QuestionOption(label="A", description="a")]
        q = Question(question="Q?", header="H", options=opts)
        resp = AskUserQuestionResponse(questions=[q], answers={"Q?": "A"})
        assert len(resp.questions) == 1
        assert resp.answers["Q?"] == "A"

    def test_tool_approval_allow(self) -> None:
        resp = ToolApprovalResponse(behavior="allow")
        assert resp.behavior == "allow"
        assert resp.message is None
        assert resp.interrupt is False

    def test_tool_approval_deny(self) -> None:
        resp = ToolApprovalResponse(behavior="deny", message="Not allowed", interrupt=True)
        assert resp.behavior == "deny"
        assert resp.message == "Not allowed"
        assert resp.interrupt is True

    def test_tool_approval_serialization(self) -> None:
        resp = ToolApprovalResponse(behavior="deny", message="nope")
        data = resp.model_dump()
        restored = ToolApprovalResponse(**data)
        assert restored == resp
