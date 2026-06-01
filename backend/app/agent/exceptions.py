"""Domain exceptions raised by the agent service layer."""

from __future__ import annotations


class InvalidCapabilityValueError(Exception):
    """A config field holds a value outside the runtime's declared capabilities.

    Raised at launch (``start_draft`` / ``run_task`` / ``continue_session``)
    and by ``update_config`` when ``model`` / ``permission_mode`` / ``effort``
    is not one of the runtime's ``capabilities()`` options. The RPC layer maps
    it to ``INVALID_CAPABILITY_VALUE`` (-32032) and forwards :attr:`rpc_data`
    as the error ``data`` so the client can render a precise message without a
    second round-trip.
    """

    def __init__(
        self, *, field: str, value: str, runtime_type: str, allowed: list[str]
    ) -> None:
        self.field = field
        self.value = value
        self.runtime_type = runtime_type
        self.allowed = allowed
        super().__init__(
            f"{field}={value!r} is not valid for runtime {runtime_type!r}; "
            f"allowed: {allowed}"
        )

    @property
    def rpc_data(self) -> dict:
        """``data`` payload for the JSON-RPC error (camelCase, wire-ready)."""
        return {
            "field": self.field,
            "value": self.value,
            "runtimeType": self.runtime_type,
            "allowed": self.allowed,
        }
