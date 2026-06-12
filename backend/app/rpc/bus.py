"""Event Bus — central pub/sub for multi-client notification routing.

All server→client notifications flow through the bus.  Services publish
events to topics; the bus fans out to subscribed connections.

Topics:
    project:{path}      — file changes, spec updates, vis state, board
    session:{thinkrail_sid} — agent events, interactive requests
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from dataclasses import dataclass, field
from time import time
from typing import Any

from starlette.websockets import WebSocketState

from app.rpc.connections import ClientConnection

logger = logging.getLogger(__name__)

# Maximum events kept per topic for replay on reconnect.
_BUFFER_MAX = 200

# Interval for the dead-connection sweep (seconds).
_SWEEP_INTERVAL = 60.0


@dataclass
class Event:
    """A single published event, buffered for replay."""

    topic: str
    method: str
    params: dict
    request_id: str | None
    timestamp: float
    source_user: str | None = None


class EventBus:
    """In-process pub/sub with per-topic ring buffers."""

    def __init__(self) -> None:
        self._connections: dict[str, ClientConnection] = {}
        self._subscriptions: dict[str, set[str]] = {}  # topic → conn_ids
        self._buffers: dict[str, deque[Event]] = {}
        self._sweep_task: asyncio.Task[None] | None = None

    # -- connection lifecycle --------------------------------------------------

    def register(self, conn: ClientConnection) -> None:
        """Register a new connection with the bus."""
        self._connections[conn.conn_id] = conn

    def unregister(self, conn_id: str) -> None:
        """Remove a connection and all its subscriptions."""
        conn = self._connections.pop(conn_id, None)
        if conn is None:
            return
        # Remove from all topic subscription sets
        for topic, subscribers in list(self._subscriptions.items()):
            subscribers.discard(conn_id)
            if not subscribers:
                del self._subscriptions[topic]
        conn.subscriptions.clear()

    def get_connection(self, conn_id: str) -> ClientConnection | None:
        return self._connections.get(conn_id)

    def connections_for_project(self, project_path: str) -> list[ClientConnection]:
        """Return all connections on a given project."""
        return [
            c for c in self._connections.values()
            if c.project_path == project_path
        ]

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    # -- subscriptions ---------------------------------------------------------

    def subscribe(self, conn_id: str, topic: str) -> None:
        """Subscribe a connection to a topic."""
        conn = self._connections.get(conn_id)
        if conn is None:
            return
        self._subscriptions.setdefault(topic, set()).add(conn_id)
        conn.subscriptions.add(topic)

    def unsubscribe(self, conn_id: str, topic: str) -> None:
        """Unsubscribe a connection from a topic."""
        conn = self._connections.get(conn_id)
        if conn is not None:
            conn.subscriptions.discard(topic)
        subs = self._subscriptions.get(topic)
        if subs is not None:
            subs.discard(conn_id)
            if not subs:
                del self._subscriptions[topic]

    def subscribers(self, topic: str) -> set[str]:
        """Return the set of conn_ids subscribed to a topic."""
        return set(self._subscriptions.get(topic, ()))

    # -- publishing ------------------------------------------------------------

    async def publish(
        self,
        topic: str,
        method: str,
        params: dict,
        request_id: str | None = None,
        source_user: str | None = None,
    ) -> None:
        """Publish an event to all subscribers of *topic*."""
        event = Event(
            topic=topic,
            method=method,
            params=params,
            request_id=request_id,
            timestamp=time(),
            source_user=source_user,
        )

        # Buffer for replay
        buf = self._buffers.get(topic)
        if buf is None:
            buf = deque(maxlen=_BUFFER_MAX)
            self._buffers[topic] = buf
        buf.append(event)

        # Fan out to subscribers
        subscriber_ids = self._subscriptions.get(topic)
        if not subscriber_ids:
            return

        message = self._build_message(method, params, request_id)
        text = json.dumps(message)

        dead: list[str] = []
        for cid in list(subscriber_ids):
            conn = self._connections.get(cid)
            if conn is None:
                dead.append(cid)
                continue
            try:
                await conn.ws.send_text(text)
            except Exception:
                # Connection likely dead — mark for cleanup but don't
                # remove mid-iteration.
                dead.append(cid)

        # Deferred cleanup of dead connections
        for cid in dead:
            subscriber_ids.discard(cid)
            logger.debug("Removed dead subscriber %s from topic %s", cid[:8], topic)

    async def publish_to_project(
        self,
        project_path: str,
        method: str,
        params: dict,
    ) -> None:
        """Convenience: publish to the project topic."""
        await self.publish(f"project:{project_path}", method, params)

    async def publish_to_session(
        self,
        thinkrail_sid: str,
        method: str,
        params: dict,
        request_id: str | None = None,
        source_user: str | None = None,
    ) -> None:
        """Convenience: publish to a session topic."""
        await self.publish(
            f"session:{thinkrail_sid}", method, params,
            request_id=request_id, source_user=source_user,
        )

    # -- replay ----------------------------------------------------------------

    async def replay(
        self, conn_id: str, topic: str, since: float
    ) -> int:
        """Replay buffered events newer than *since* to a single connection.

        Returns the number of events replayed.
        """
        conn = self._connections.get(conn_id)
        if conn is None:
            return 0
        buf = self._buffers.get(topic)
        if not buf:
            return 0

        count = 0
        for event in buf:
            if event.timestamp <= since:
                continue
            message = self._build_message(event.method, event.params, event.request_id)
            try:
                await conn.ws.send_text(json.dumps(message))
                count += 1
            except Exception:
                break
        return count

    # -- topic cleanup ---------------------------------------------------------

    def cleanup_topic(self, topic: str) -> None:
        """Remove a topic's buffer and subscriptions (e.g. session ended)."""
        self._buffers.pop(topic, None)
        self._subscriptions.pop(topic, None)
        # Also remove from connection subscription sets
        for conn in self._connections.values():
            conn.subscriptions.discard(topic)

    # -- dead-connection sweep -------------------------------------------------

    def start_sweep(self) -> None:
        """Start the periodic dead-connection sweep task."""
        if self._sweep_task is None or self._sweep_task.done():
            self._sweep_task = asyncio.create_task(self._sweep_loop())

    def stop_sweep(self) -> None:
        """Stop the sweep task."""
        if self._sweep_task and not self._sweep_task.done():
            self._sweep_task.cancel()
            self._sweep_task = None

    async def _sweep_loop(self) -> None:
        """Periodically check for and remove dead connections."""
        try:
            while True:
                await asyncio.sleep(_SWEEP_INTERVAL)
                self._sweep_dead()
        except asyncio.CancelledError:
            pass

    def _sweep_dead(self) -> None:
        """Remove connections whose WebSocket is no longer open."""
        dead = [
            cid for cid, conn in self._connections.items()
            if conn.ws.client_state != WebSocketState.CONNECTED
        ]
        for cid in dead:
            logger.info("Sweeping dead connection %s", cid[:8])
            self.unregister(cid)

    # -- helpers ---------------------------------------------------------------

    @staticmethod
    def _build_message(
        method: str, params: dict, request_id: str | None
    ) -> dict[str, Any]:
        """Build a JSON-RPC notification or request message."""
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if request_id is not None:
            msg["id"] = request_id
            params = {**params, "requestId": request_id}
        msg["params"] = params
        return msg


# Module-level singleton — initialised once, imported everywhere.
bus = EventBus()
