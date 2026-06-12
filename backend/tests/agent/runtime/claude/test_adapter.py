"""Tests for ``runtime/claude/adapter.py`` event-shape builders.

These functions define the wire contract that any runtime adapter must
mirror. The tests assert that:

- ``agent/toolCallStart`` payloads have a stable, byte-equal shape for a
  given input — no field reordering, no surprise additions.
- ``agentId`` is omitted (not ``None``) when the source has no parent
  subagent. Frontend filters by key presence.
- ``agent/toolCallEnd`` payloads carry an empty ``toolName`` (Claude
  ToolResultBlock has no name; the wire shape stays consistent across
  runtimes by always emitting the key).
"""

from __future__ import annotations

from app.agent.runtime.claude.adapter import (
    build_text_delta_params,
    build_tool_call_end_params,
    build_tool_call_start_params,
)


class TestBuildToolCallStartParams:
    """Lock the ``agent/toolCallStart`` wire shape."""

    def test_full_shape_for_edit_call(self) -> None:
        params = build_tool_call_start_params(
            thinkrail_sid="sid-123",
            session_id="sess-abc",
            tool_use_id="tu-001",
            tool_name="Edit",
            tool_input={"file_path": "/x.py", "old_string": "a", "new_string": "b"},
        )
        assert params == {
            "thinkrailSid": "sid-123",
            "sessionId": "sess-abc",
            "toolUseId": "tu-001",
            "toolName": "Edit",
            "toolInput": {"file_path": "/x.py", "old_string": "a", "new_string": "b"},
        }

    def test_omits_agent_id_when_none(self) -> None:
        params = build_tool_call_start_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            tool_name="Read", tool_input={},
        )
        assert "agentId" not in params

    def test_includes_agent_id_when_set(self) -> None:
        params = build_tool_call_start_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            tool_name="Read", tool_input={}, agent_id="sub-1",
        )
        assert params["agentId"] == "sub-1"

    def test_preserves_tool_input_dict_identity_semantics(self) -> None:
        # The input dict is passed through verbatim — caller is responsible
        # for any preprocessing (e.g. _previousContent injection for Write).
        custom_input = {
            "file_path": "/x", "content": "hi", "_previousContent": "prev",
        }
        params = build_tool_call_start_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            tool_name="Write", tool_input=custom_input,
        )
        assert params["toolInput"] == custom_input

    def test_field_order_is_stable(self) -> None:
        # The frontend does not require ordered keys, but byte-equality
        # in tests is easier when the order is deterministic.
        params = build_tool_call_start_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            tool_name="Bash", tool_input={"command": "ls"}, agent_id="a",
        )
        assert list(params.keys()) == [
            "thinkrailSid", "sessionId", "toolUseId", "toolName", "toolInput", "agentId",
        ]


class TestBuildToolCallEndParams:
    """Lock the ``agent/toolCallEnd`` wire shape."""

    def test_default_tool_name_is_empty(self) -> None:
        # Claude's ToolResultBlock has no name; the empty string is the
        # canonical marker that the frontend should resolve from the
        # matching toolCallStart event.
        params = build_tool_call_end_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            output="ok", is_error=False,
        )
        assert params["toolName"] == ""

    def test_full_shape(self) -> None:
        params = build_tool_call_end_params(
            thinkrail_sid="sid-1", session_id="sess", tool_use_id="tu-9",
            output="result text", is_error=False,
        )
        assert params == {
            "thinkrailSid": "sid-1",
            "sessionId": "sess",
            "toolUseId": "tu-9",
            "toolName": "",
            "output": "result text",
            "isError": False,
        }

    def test_error_flag_propagates(self) -> None:
        params = build_tool_call_end_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            output="boom", is_error=True,
        )
        assert params["isError"] is True
        assert params["output"] == "boom"

    def test_tool_name_can_be_supplied(self) -> None:
        # A runtime that carries the tool name on its result can pass it
        # through; the wire shape carries it untouched.
        params = build_tool_call_end_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            output="42", is_error=False, tool_name="Bash",
        )
        assert params["toolName"] == "Bash"

    def test_omits_agent_id_when_none(self) -> None:
        params = build_tool_call_end_params(
            thinkrail_sid="sid", session_id="s", tool_use_id="t",
            output="", is_error=False,
        )
        assert "agentId" not in params


class TestBuildTextDeltaParams:
    """Lock the ``agent/textDelta`` wire shape."""

    def test_basic_shape(self) -> None:
        params = build_text_delta_params(
            thinkrail_sid="sid", session_id="s", text="hello",
        )
        assert params == {
            "thinkrailSid": "sid",
            "sessionId": "s",
            "text": "hello",
        }

    def test_includes_agent_id(self) -> None:
        params = build_text_delta_params(
            thinkrail_sid="sid", session_id="s", text="hi", agent_id="sub-1",
        )
        assert params["agentId"] == "sub-1"

    def test_omits_agent_id_when_none(self) -> None:
        params = build_text_delta_params(
            thinkrail_sid="sid", session_id="s", text="hi",
        )
        assert "agentId" not in params


class TestWireContract:
    """The shape builders are the wire contract every runtime must mirror.

    These tests assert structural properties any runtime adapter must
    preserve — same keys, same order, same type semantics.
    """

    def test_tool_call_start_keys_match_documented_contract(self) -> None:
        params = build_tool_call_start_params(
            thinkrail_sid="x", session_id="x", tool_use_id="x",
            tool_name="Edit", tool_input={"a": 1},
        )
        # The minimum required key set every runtime adapter must produce.
        required_keys = {"thinkrailSid", "sessionId", "toolUseId", "toolName", "toolInput"}
        assert required_keys.issubset(params.keys())

    def test_tool_call_end_keys_match_documented_contract(self) -> None:
        params = build_tool_call_end_params(
            thinkrail_sid="x", session_id="x", tool_use_id="x",
            output="", is_error=False,
        )
        required_keys = {"thinkrailSid", "sessionId", "toolUseId", "toolName", "output", "isError"}
        assert required_keys.issubset(params.keys())

    def test_no_unexpected_keys_in_minimal_shape(self) -> None:
        # Without agent_id, the start event must have exactly 5 keys —
        # an adapter must NOT introduce extra keys for the same logical
        # event (e.g. no separate `parent_id` field).
        params = build_tool_call_start_params(
            thinkrail_sid="x", session_id="x", tool_use_id="x",
            tool_name="Read", tool_input={},
        )
        assert len(params) == 5
