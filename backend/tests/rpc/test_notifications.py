from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.rpc.notifications import make_notify


@pytest.fixture
def mock_ws() -> AsyncMock:
    ws = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


class TestMakeNotify:
    async def test_sends_notification_without_id(self, mock_ws: AsyncMock) -> None:
        notify = make_notify(mock_ws)
        await notify("spec/didChange", {"id": "mod-a", "changes": {}})

        mock_ws.send_text.assert_called_once()
        msg = json.loads(mock_ws.send_text.call_args[0][0])
        assert msg["jsonrpc"] == "2.0"
        assert msg["method"] == "spec/didChange"
        assert msg["params"] == {"id": "mod-a", "changes": {}}
        assert "id" not in msg

    async def test_sends_request_with_id(self, mock_ws: AsyncMock) -> None:
        notify = make_notify(mock_ws)
        await notify("agent/askUserQuestion", {"thinkrailSid": "t1"}, request_id="req-42")

        mock_ws.send_text.assert_called_once()
        msg = json.loads(mock_ws.send_text.call_args[0][0])
        assert msg["jsonrpc"] == "2.0"
        assert msg["method"] == "agent/askUserQuestion"
        assert msg["id"] == "req-42"
        assert msg["params"]["thinkrailSid"] == "t1"
        assert msg["params"]["requestId"] == "req-42"

    async def test_does_not_mutate_original_params(self, mock_ws: AsyncMock) -> None:
        notify = make_notify(mock_ws)
        params = {"thinkrailSid": "t1"}
        await notify("agent/askUserQuestion", params, request_id="req-1")

        assert "requestId" not in params

    async def test_multiple_calls_use_same_ws(self, mock_ws: AsyncMock) -> None:
        notify = make_notify(mock_ws)
        await notify("spec/didCreate", {"id": "a"})
        await notify("spec/didDelete", {"id": "b"})

        assert mock_ws.send_text.call_count == 2
