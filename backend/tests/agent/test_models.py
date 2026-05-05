from __future__ import annotations

import json
from pathlib import Path

from pydantic import TypeAdapter

from app.agent.models import (
    AgentConfig,
    AgentEvent,
    AgentResult,
    AgentTask,
    AskUserQuestionPayload,
    AskUserQuestionResponse,
    Question,
    QuestionOption,
    TextDeltaEvent,
    TextDeltaPayload,
    ToolApprovalResponse,
    agent_event_json_schema,
)


class TestAgentConfig:
    def test_defaults(self) -> None:
        cfg = AgentConfig()
        assert cfg.model == "claude-sonnet-4-6"
        assert cfg.max_turns == 50
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

    def test_wire_format_uses_camel_case(self) -> None:
        cfg = AgentConfig(max_turns=10, permission_mode="strict", stream_text=False)
        data = cfg.model_dump(by_alias=True)
        assert "maxTurns" in data
        assert "permissionMode" in data
        assert "streamText" in data
        assert data["maxTurns"] == 10
        assert data["permissionMode"] == "strict"
        assert data["streamText"] is False
        # snake_case keys should not appear in wire format
        assert "max_turns" not in data
        assert "permission_mode" not in data
        assert "stream_text" not in data


class TestAgentTask:
    def test_defaults(self) -> None:
        task = AgentTask()
        assert len(task.bonsai_sid) > 0
        assert task.status == "initializing"
        assert task.spec_ids == []
        assert task.session_id is None
        assert task.created != ""
        assert task.updated != ""

    def test_unique_ids(self) -> None:
        t1 = AgentTask()
        t2 = AgentTask()
        assert t1.bonsai_sid != t2.bonsai_sid

    def test_custom_values(self) -> None:
        cfg = AgentConfig(model="claude-opus-4-6")
        task = AgentTask(
            bonsai_sid="test-id",
            status="running",
            spec_ids=["spec-1", "spec-2"],
            config=cfg,
            session_id="sess-1",
        )
        assert task.bonsai_sid == "test-id"
        assert task.status == "running"
        assert task.spec_ids == ["spec-1", "spec-2"]
        assert task.config.model == "claude-opus-4-6"
        assert task.session_id == "sess-1"

    def test_serialization_round_trip(self) -> None:
        task = AgentTask(spec_ids=["s1"])
        data = task.model_dump()
        restored = AgentTask(**data)
        assert restored.bonsai_sid == task.bonsai_sid
        assert restored.spec_ids == ["s1"]

    def test_wire_format_uses_camel_case(self) -> None:
        task = AgentTask(bonsai_sid="t1", spec_ids=["s1"], session_id="sess-1")
        data = task.model_dump(by_alias=True)
        assert "bonsaiSid" in data
        assert "specIds" in data
        assert "sessionId" in data
        assert data["bonsaiSid"] == "t1"
        assert data["specIds"] == ["s1"]
        assert data["sessionId"] == "sess-1"
        # nested config should also use camelCase
        assert "maxTurns" in data["config"]
        assert "permissionMode" in data["config"]
        assert "streamText" in data["config"]
        # snake_case keys should not appear
        assert "bonsai_sid" not in data
        assert "spec_ids" not in data
        assert "session_id" not in data


class TestAgentEvent:
    def test_construction(self) -> None:
        event = TextDeltaEvent(
            bonsai_sid="t1",
            session_id="s1",
            event_type="textDelta",
            payload=TextDeltaPayload(text="hello"),
        )
        assert event.bonsai_sid == "t1"
        assert event.event_type == "textDelta"
        assert event.payload.text == "hello"

    def test_wire_format_uses_camel_case(self) -> None:
        event = TextDeltaEvent(
            bonsai_sid="t1",
            session_id="s1",
            event_type="textDelta",
            payload=TextDeltaPayload(text="hi"),
        )
        data = event.model_dump(by_alias=True)
        assert "bonsaiSid" in data
        assert "sessionId" in data
        assert "eventType" in data
        assert data["bonsaiSid"] == "t1"
        assert data["eventType"] == "textDelta"
        assert data["payload"]["text"] == "hi"
        assert "bonsai_sid" not in data
        assert "session_id" not in data
        assert "event_type" not in data

    def test_discriminated_union_validation(self) -> None:
        ta = TypeAdapter(AgentEvent)
        event = ta.validate_python({
            "eventType": "askUserQuestion",
            "bonsaiSid": "t1",
            "payload": {
                "questions": [{"question": "Q?", "header": "H", "options": []}],
            },
        })
        assert event.event_type == "askUserQuestion"
        assert event.payload.questions[0].question == "Q?"

    def test_schema_has_discriminator(self) -> None:
        ta = TypeAdapter(AgentEvent)
        schema = ta.json_schema(by_alias=True)
        assert "discriminator" in schema
        assert schema["discriminator"]["propertyName"] == "eventType"
        assert "textDelta" in schema["discriminator"]["mapping"]


class TestAgentResult:
    def test_construction(self) -> None:
        result = AgentResult(
            bonsai_sid="t1",
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
            bonsai_sid="t1",
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

    def test_question_wire_format(self) -> None:
        opts = [QuestionOption(label="A", description="a")]
        q = Question(question="Q?", header="H", options=opts, multi_select=True)
        data = q.model_dump(by_alias=True)
        assert "multiSelect" in data
        assert data["multiSelect"] is True
        assert "multi_select" not in data

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


class TestWsSchemaSync:
    """ws-events.json must be kept in sync with models.py.

    If this test fails, run:
        cd frontend && npm run generate:ws-schema && npm run generate:ws-types
    """

    def test_ws_events_json_matches_models(self) -> None:
        ws_events_path = (
            Path(__file__).parent.parent.parent.parent / "frontend" / "ws-events.json"
        )
        assert ws_events_path.is_file(), (
            f"ws-events.json not found at {ws_events_path}.\n"
            "Run: cd frontend && npm run generate:ws-schema && npm run generate:ws-types"
        )

        committed = json.loads(ws_events_path.read_text())
        current = agent_event_json_schema()

        assert current == committed, (
            "ws-events.json is out of sync with app/agent/models.py.\n"
            "Run: cd frontend && npm run generate:ws-schema && npm run generate:ws-types"
        )
