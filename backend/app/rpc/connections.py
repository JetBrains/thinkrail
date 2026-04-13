"""Client connection model for multi-client WebSocket support."""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from time import time

from starlette.websockets import WebSocket

from app.rpc.notifications import NotifyCallable


# Context variable set during RPC dispatch so handlers know which
# connection is calling without changing every method signature.
current_conn_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_conn_id")


@dataclass
class ClientConnection:
    """Tracks a single WebSocket connection and its subscriptions."""

    conn_id: str
    user_id: str  # from token lookup, or "anonymous"
    display_name: str
    ws: WebSocket
    notify: NotifyCallable
    project_path: str
    connected_at: float = field(default_factory=time)
    subscriptions: set[str] = field(default_factory=set)
