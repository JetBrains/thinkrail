"""Tests for RuntimeEvent and make_handler_from_notify."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.agent.runtime.events import (
    AgentEventHandler,
    RuntimeEvent,
    make_handler_from_notify,
)


class TestRuntimeEvent:
    def test_minimal_construction(self):
        ev = RuntimeEvent(method="agent/textDelta", params={"text": "hi"})
        assert ev.method == "agent/textDelta"
        assert ev.params == {"text": "hi"}
        assert ev.request_id is None

    def test_with_request_id(self):
        ev = RuntimeEvent(
            method="agent/confirmAction",
            params={"toolName": "Bash"},
            request_id="req-42",
        )
        assert ev.request_id == "req-42"

    def test_round_trip(self):
        ev = RuntimeEvent(
            method="agent/askUserQuestion",
            params={"question": "ok?"},
            request_id="r-1",
        )
        dumped = ev.model_dump()
        assert dumped == {
            "method": "agent/askUserQuestion",
            "params": {"question": "ok?"},
            "request_id": "r-1",
        }
        restored = RuntimeEvent.model_validate(dumped)
        assert restored == ev

    def test_method_required(self):
        with pytest.raises(ValidationError):
            RuntimeEvent(params={})  # type: ignore[call-arg]

    def test_extra_fields_rejected(self):
        with pytest.raises(ValidationError):
            RuntimeEvent.model_validate(
                {
                    "method": "agent/textDelta",
                    "params": {},
                    "extra_field": "nope",
                }
            )


class _RecordingNotify:
    """Stand-in for ``make_notify``-produced callables.

    Captures every invocation as a ``(method, params, request_id)`` tuple
    so tests can assert exactly what the handler forwarded.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict, str | None]] = []

    async def __call__(
        self, method: str, params: dict, request_id: str | None = None
    ) -> None:
        self.calls.append((method, params, request_id))


class TestMakeHandlerFromNotify:
    def test_returned_object_satisfies_protocol(self):
        notify = _RecordingNotify()
        handler = make_handler_from_notify(notify)
        assert isinstance(handler, AgentEventHandler)

    @pytest.mark.asyncio
    async def test_on_event_forwards_one_notify_per_event(self):
        notify = _RecordingNotify()
        handler = make_handler_from_notify(notify)

        await handler.on_event(
            RuntimeEvent(method="agent/textDelta", params={"text": "a"})
        )
        await handler.on_event(
            RuntimeEvent(method="agent/textDelta", params={"text": "b"})
        )

        assert notify.calls == [
            ("agent/textDelta", {"text": "a"}, None),
            ("agent/textDelta", {"text": "b"}, None),
        ]

    @pytest.mark.asyncio
    async def test_on_event_forwards_request_id_kwarg(self):
        # Load-bearing: without request_id forwarding, agent/confirmAction
        # and agent/askUserQuestion lose their JSON-RPC id and the
        # frontend's agent/respond flow can't match a reply to the prompt.
        notify = _RecordingNotify()
        handler = make_handler_from_notify(notify)

        await handler.on_event(
            RuntimeEvent(
                method="agent/confirmAction",
                params={"toolName": "Bash"},
                request_id="req-7",
            )
        )

        assert notify.calls == [
            ("agent/confirmAction", {"toolName": "Bash"}, "req-7"),
        ]

    @pytest.mark.asyncio
    async def test_on_event_preserves_params_identity_payload(self):
        notify = _RecordingNotify()
        handler = make_handler_from_notify(notify)
        params = {"toolName": "Read", "input": {"file": "a.py"}}

        await handler.on_event(
            RuntimeEvent(method="agent/toolUse", params=params)
        )

        assert len(notify.calls) == 1
        method, forwarded, request_id = notify.calls[0]
        assert method == "agent/toolUse"
        assert forwarded == params
        assert request_id is None

