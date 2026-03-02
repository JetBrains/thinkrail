from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from starlette.websockets import WebSocket

NotifyCallable = Callable[[str, dict, str | None], Awaitable[None]]

current_notify: NotifyCallable | None = None


def make_notify(websocket: WebSocket) -> NotifyCallable:
    """Create a notify callable bound to *websocket*.

    Returned callable signature::

        async def notify(method: str, params: dict, request_id: str | None = None) -> None

    * ``request_id=None`` → JSON-RPC **notification** (no ``id`` field).
    * ``request_id`` set  → JSON-RPC **request** (``id`` = *request_id*,
      ``params.requestId`` injected so the client can reference it in
      ``agent/respond``).
    """

    async def notify(
        method: str, params: dict, request_id: str | None = None
    ) -> None:
        message: dict = {"jsonrpc": "2.0", "method": method}
        if request_id is not None:
            message["id"] = request_id
            params = {**params, "requestId": request_id}
        message["params"] = params
        await websocket.send_text(json.dumps(message))

    return notify
