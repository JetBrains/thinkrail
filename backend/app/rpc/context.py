"""RPC request context — per-request identity and shared subscription helpers.

``current_conn_id`` is set by the WebSocket dispatch loop before each handler
call.  Use ``get_current_conn()`` to retrieve the full ``ClientConnection`` in
any handler without passing the connection explicitly through every call site.
"""

from __future__ import annotations

import contextvars

# Avoid circular import: bus imported lazily inside functions.

current_conn_id: contextvars.ContextVar[str] = contextvars.ContextVar("current_conn_id")


def get_current_conn():
    """Return the ``ClientConnection`` for the current RPC request, or ``None``."""
    from app.rpc.bus import bus

    try:
        return bus.get_connection(current_conn_id.get())
    except LookupError:
        return None


def auto_subscribe_all(bonsai_sid: str) -> None:
    """Subscribe every connection on the same project to *bonsai_sid*'s topic.

    Phase 1 behaviour: all clients on the project receive all session events.
    Phase 3 will restrict this to explicit per-client subscriptions.
    """
    from app.rpc.bus import bus

    conn = get_current_conn()
    if conn:
        topic = f"session:{bonsai_sid}"
        for c in bus.connections_for_project(conn.project_path):
            bus.subscribe(c.conn_id, topic)
