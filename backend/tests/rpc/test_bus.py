"""Tests for the EventBus pub/sub system."""

from __future__ import annotations

import asyncio
import json
from time import time
from unittest.mock import AsyncMock, MagicMock, PropertyMock

import pytest
from starlette.websockets import WebSocketState

from app.rpc.bus import EventBus
from app.rpc.connections import ClientConnection
from app.rpc.notifications import make_notify


def _make_conn(conn_id: str = "c1", project: str = "/proj") -> ClientConnection:
    """Create a ClientConnection with a mock WebSocket."""
    ws = AsyncMock()
    ws.send_text = AsyncMock()
    type(ws).client_state = PropertyMock(return_value=WebSocketState.CONNECTED)
    return ClientConnection(
        conn_id=conn_id,
        user_id="anonymous",
        display_name="Test",
        ws=ws,
        notify=make_notify(ws),
        project_path=project,
    )


# -- Registration and lifecycle ------------------------------------------------

class TestRegistration:
    def test_register_and_unregister(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        assert bus.connection_count == 1
        assert bus.get_connection("c1") is conn

        bus.unregister("c1")
        assert bus.connection_count == 0
        assert bus.get_connection("c1") is None

    def test_unregister_nonexistent_is_noop(self) -> None:
        bus = EventBus()
        bus.unregister("ghost")  # should not raise

    def test_connections_for_project(self) -> None:
        bus = EventBus()
        c1 = _make_conn("c1", "/projA")
        c2 = _make_conn("c2", "/projB")
        c3 = _make_conn("c3", "/projA")
        bus.register(c1)
        bus.register(c2)
        bus.register(c3)

        proj_a = bus.connections_for_project("/projA")
        assert len(proj_a) == 2
        assert {c.conn_id for c in proj_a} == {"c1", "c3"}


# -- Subscriptions -------------------------------------------------------------

class TestSubscriptions:
    def test_subscribe_and_unsubscribe(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)

        bus.subscribe("c1", "session:abc")
        assert "c1" in bus.subscribers("session:abc")
        assert "session:abc" in conn.subscriptions

        bus.unsubscribe("c1", "session:abc")
        assert "c1" not in bus.subscribers("session:abc")
        assert "session:abc" not in conn.subscriptions

    def test_subscribe_nonexistent_connection_is_noop(self) -> None:
        bus = EventBus()
        bus.subscribe("ghost", "topic")  # should not raise
        assert bus.subscribers("topic") == set()

    def test_unregister_cleans_up_subscriptions(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:a")
        bus.subscribe("c1", "session:b")

        bus.unregister("c1")
        assert bus.subscribers("session:a") == set()
        assert bus.subscribers("session:b") == set()

    def test_cleanup_topic(self) -> None:
        bus = EventBus()
        c1 = _make_conn("c1")
        c2 = _make_conn("c2")
        bus.register(c1)
        bus.register(c2)
        bus.subscribe("c1", "session:x")
        bus.subscribe("c2", "session:x")

        bus.cleanup_topic("session:x")
        assert bus.subscribers("session:x") == set()
        assert "session:x" not in c1.subscriptions
        assert "session:x" not in c2.subscriptions


# -- Publishing ----------------------------------------------------------------

class TestPublish:
    async def test_publish_to_subscribers(self) -> None:
        bus = EventBus()
        c1 = _make_conn("c1")
        c2 = _make_conn("c2")
        bus.register(c1)
        bus.register(c2)
        bus.subscribe("c1", "session:abc")
        bus.subscribe("c2", "session:abc")

        await bus.publish("session:abc", "agent/textDelta", {"text": "hi"})

        # Both should receive the message
        assert c1.ws.send_text.call_count == 1
        assert c2.ws.send_text.call_count == 1
        msg = json.loads(c1.ws.send_text.call_args[0][0])
        assert msg["method"] == "agent/textDelta"
        assert msg["params"]["text"] == "hi"
        assert "id" not in msg  # notification, no request_id

    async def test_publish_with_request_id(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        await bus.publish("session:abc", "agent/askUserQuestion", {"q": 1}, request_id="req-42")

        msg = json.loads(conn.ws.send_text.call_args[0][0])
        assert msg["id"] == "req-42"
        assert msg["params"]["requestId"] == "req-42"
        assert msg["params"]["q"] == 1

    async def test_publish_only_to_subscribers(self) -> None:
        bus = EventBus()
        c1 = _make_conn("c1")
        c2 = _make_conn("c2")
        bus.register(c1)
        bus.register(c2)
        bus.subscribe("c1", "session:abc")
        # c2 is NOT subscribed

        await bus.publish("session:abc", "agent/textDelta", {"text": "hi"})

        assert c1.ws.send_text.call_count == 1
        assert c2.ws.send_text.call_count == 0

    async def test_publish_no_subscribers_is_noop(self) -> None:
        bus = EventBus()
        # No connections at all
        await bus.publish("session:abc", "agent/textDelta", {"text": "hi"})
        # Should not raise

    async def test_publish_dead_connection_removed_from_subscribers(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        conn.ws.send_text.side_effect = Exception("dead")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        await bus.publish("session:abc", "agent/textDelta", {"text": "hi"})

        # c1 should be removed from subscribers after send failure
        assert "c1" not in bus.subscribers("session:abc")

    async def test_publish_to_project_convenience(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1", "/proj")
        bus.register(conn)
        bus.subscribe("c1", "project:/proj")

        await bus.publish_to_project("/proj", "spec/didChange", {"id": "s1"})

        msg = json.loads(conn.ws.send_text.call_args[0][0])
        assert msg["method"] == "spec/didChange"

    async def test_publish_to_session_convenience(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:sid1")

        await bus.publish_to_session("sid1", "agent/done", {"bonsaiSid": "sid1"})

        msg = json.loads(conn.ws.send_text.call_args[0][0])
        assert msg["method"] == "agent/done"


# -- Buffering and replay -----------------------------------------------------

class TestReplay:
    async def test_replay_sends_buffered_events(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        before = time()
        await bus.publish("session:abc", "agent/textDelta", {"text": "a"})
        await bus.publish("session:abc", "agent/textDelta", {"text": "b"})

        # Reset mock to track replay calls separately
        conn.ws.send_text.reset_mock()

        count = await bus.replay("c1", "session:abc", since=before - 1)
        assert count == 2
        assert conn.ws.send_text.call_count == 2

    async def test_replay_filters_by_timestamp(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        await bus.publish("session:abc", "agent/textDelta", {"text": "old"})
        middle = time()
        await bus.publish("session:abc", "agent/textDelta", {"text": "new"})

        conn.ws.send_text.reset_mock()
        count = await bus.replay("c1", "session:abc", since=middle)
        assert count == 1
        msg = json.loads(conn.ws.send_text.call_args[0][0])
        assert msg["params"]["text"] == "new"

    async def test_replay_empty_buffer(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)

        count = await bus.replay("c1", "session:abc", since=0)
        assert count == 0

    async def test_replay_nonexistent_connection(self) -> None:
        bus = EventBus()
        count = await bus.replay("ghost", "session:abc", since=0)
        assert count == 0

    async def test_buffer_bounded(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        # Publish more than buffer max (200)
        for i in range(250):
            await bus.publish("session:abc", "agent/textDelta", {"i": i})

        conn.ws.send_text.reset_mock()
        count = await bus.replay("c1", "session:abc", since=0)
        assert count == 200  # bounded by maxlen

    async def test_cleanup_topic_clears_buffer(self) -> None:
        bus = EventBus()
        conn = _make_conn("c1")
        bus.register(conn)
        bus.subscribe("c1", "session:abc")

        await bus.publish("session:abc", "agent/textDelta", {"text": "x"})
        bus.cleanup_topic("session:abc")

        conn.ws.send_text.reset_mock()
        count = await bus.replay("c1", "session:abc", since=0)
        assert count == 0


# -- Dead connection sweep -----------------------------------------------------

class TestSweep:
    def test_sweep_removes_dead_connections(self) -> None:
        bus = EventBus()
        alive = _make_conn("alive")
        dead = _make_conn("dead")
        type(dead.ws).client_state = PropertyMock(return_value=WebSocketState.DISCONNECTED)

        bus.register(alive)
        bus.register(dead)
        bus.subscribe("alive", "session:x")
        bus.subscribe("dead", "session:x")

        bus._sweep_dead()

        assert bus.connection_count == 1
        assert bus.get_connection("alive") is not None
        assert bus.get_connection("dead") is None
        assert "dead" not in bus.subscribers("session:x")

    def test_sweep_no_connections_is_noop(self) -> None:
        bus = EventBus()
        bus._sweep_dead()  # should not raise


# -- Multi-client scenarios ----------------------------------------------------

class TestMultiClient:
    async def test_two_clients_same_session(self) -> None:
        """Both clients subscribed to the same session receive all events."""
        bus = EventBus()
        c1 = _make_conn("c1", "/proj")
        c2 = _make_conn("c2", "/proj")
        bus.register(c1)
        bus.register(c2)
        bus.subscribe("c1", "session:sid")
        bus.subscribe("c2", "session:sid")

        await bus.publish_to_session("sid", "agent/textDelta", {"text": "hello"})

        assert c1.ws.send_text.call_count == 1
        assert c2.ws.send_text.call_count == 1

    async def test_project_broadcast_reaches_all(self) -> None:
        """Project-level events reach all connections on that project."""
        bus = EventBus()
        c1 = _make_conn("c1", "/proj")
        c2 = _make_conn("c2", "/proj")
        c3 = _make_conn("c3", "/other")
        bus.register(c1)
        bus.register(c2)
        bus.register(c3)
        bus.subscribe("c1", "project:/proj")
        bus.subscribe("c2", "project:/proj")
        bus.subscribe("c3", "project:/other")

        await bus.publish_to_project("/proj", "spec/didChange", {"id": "s1"})

        assert c1.ws.send_text.call_count == 1
        assert c2.ws.send_text.call_count == 1
        assert c3.ws.send_text.call_count == 0  # different project

    async def test_one_dead_does_not_block_others(self) -> None:
        """A dead connection doesn't prevent delivery to other subscribers."""
        bus = EventBus()
        c1 = _make_conn("c1")
        c2 = _make_conn("c2")
        c1.ws.send_text.side_effect = Exception("dead")
        bus.register(c1)
        bus.register(c2)
        bus.subscribe("c1", "session:abc")
        bus.subscribe("c2", "session:abc")

        await bus.publish_to_session("abc", "agent/textDelta", {"text": "hi"})

        # c2 should still receive despite c1 being dead
        assert c2.ws.send_text.call_count == 1
