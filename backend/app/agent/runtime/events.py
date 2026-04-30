"""Runtime event types — RuntimeEvent, AgentEventHandler.

Runtimes (Claude SDK today, Codex / others later) emit a unified
``RuntimeEvent`` stream that adapters can forward verbatim onto the
WebSocket. Naming note: ``RuntimeEvent`` is the *runtime-layer* envelope
(method/params/request_id) — distinct from ``AgentEvent`` in
``app/agent/models.py``, which is the persisted/discriminated union.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from app.rpc.notifications import NotifyCallable


class RuntimeEvent(BaseModel):
    """A single event emitted by a runtime to its handler.

    Mirrors the JSON-RPC notification/request shape: ``method`` is the
    JSON-RPC method name (e.g. ``"agent/textDelta"``), ``params`` is the
    payload dict, and ``request_id`` — when set — turns the event into a
    JSON-RPC *request* so the frontend can reply via ``agent/respond``.
    """

    model_config = ConfigDict(extra="forbid")

    method: str
    params: dict[str, Any] = Field(default_factory=dict)
    request_id: str | None = None


@runtime_checkable
class AgentEventHandler(Protocol):
    """Handler invoked by a runtime for each event.

    ``on_event`` is called for every ``RuntimeEvent`` produced by the
    runtime. Completion is signaled by the ``AgentResult`` returned from
    ``IAgentRuntime.run_session`` plus a final ``agent/done`` event
    emitted on the same handler. Implementations are responsible for
    serializing / forwarding events to the appropriate transport
    (WebSocket today).
    """

    async def on_event(self, event: RuntimeEvent) -> None: ...


def make_handler_from_notify(notify: NotifyCallable) -> AgentEventHandler:
    """Wrap a ``notify`` callable (from ``rpc.notifications.make_notify``).

    The returned handler forwards each ``RuntimeEvent`` to one ``notify``
    call, preserving ``request_id`` so that ``agent/confirmAction`` /
    ``agent/askUserQuestion`` events keep their JSON-RPC id and the
    frontend can reply via ``agent/respond``.
    """

    class _NotifyHandler:
        async def on_event(self, event: RuntimeEvent) -> None:
            await notify(event.method, event.params, request_id=event.request_id)

    return _NotifyHandler()
