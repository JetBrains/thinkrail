"""``RuntimeRegistry`` — lookup table from ``RuntimeType`` to live runtime.

Holds one ``IAgentRuntime`` instance per backend kind. Concrete runtimes
are constructed by the wiring layer (``rpc.project_context``) and
registered here so that ``AgentService`` can dispatch ``AgentTask``s by
``task.config.runtime`` without caring about how each runtime was built.

Runtimes are protocol-stateless: the registry doesn't drive any
startup/shutdown handshake — any per-runtime caching is an internal
implementation detail (e.g. ``ClaudeModelRegistry`` loads its catalog
on construction from the package-shipped ``models.json``).
"""

from __future__ import annotations

import logging

from app.agent.runtime.types import IAgentRuntime, RuntimeType

logger = logging.getLogger(__name__)


class RuntimeRegistryError(Exception):
    """Base class for ``RuntimeRegistry`` lookup / registration errors."""


class DuplicateRuntimeError(RuntimeRegistryError):
    """Raised when ``register`` is called twice for the same ``RuntimeType``."""


class UnknownRuntimeError(RuntimeRegistryError):
    """Raised when a caller asks for a ``RuntimeType`` that wasn't registered.

    The RPC layer translates this to ``UNKNOWN_RUNTIME`` (-32031) so a
    request for a runtime key with no registered instance gets a clean
    domain error instead of an opaque ``INTERNAL_ERROR``.
    """


class RuntimeRegistry:
    """Registry of live ``IAgentRuntime`` instances keyed by ``RuntimeType``."""

    def __init__(self) -> None:
        self._runtimes: dict[RuntimeType, IAgentRuntime] = {}

    def register(self, runtime: IAgentRuntime) -> None:
        rt = runtime.runtime_type
        if rt in self._runtimes:
            raise DuplicateRuntimeError(f"Runtime already registered: {rt}")
        self._runtimes[rt] = runtime

    def get(self, runtime_type: RuntimeType) -> IAgentRuntime:
        try:
            return self._runtimes[runtime_type]
        except KeyError as exc:
            raise UnknownRuntimeError(f"Runtime not registered: {runtime_type}") from exc

    def has(self, runtime_type: RuntimeType) -> bool:
        return runtime_type in self._runtimes

    def all(self) -> list[IAgentRuntime]:
        """Return registered runtimes sorted by ``runtime_type``.

        Deterministic ordering keeps wire output (e.g. ``runtimes/list``)
        stable across processes, so the frontend runtime list doesn't
        shuffle based on registration order.
        """
        return [self._runtimes[k] for k in sorted(self._runtimes)]
