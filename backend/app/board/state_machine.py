from __future__ import annotations

from app.board.models import TicketStatus

VALID_TRANSITIONS: dict[TicketStatus, list[TicketStatus]] = {
    "idea": ["product-design"],
    "product-design": ["idea", "technical-design"],
    "technical-design": ["product-design", "amend-specs"],
    "amend-specs": ["technical-design", "implementation-plan"],
    "implementation-plan": ["amend-specs", "implementing"],
    "implementing": ["implementation-plan", "done"],
    "done": ["implementing"],
}


class InvalidTransitionError(ValueError):
    """Raised when a status transition is not allowed."""

    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(
            f"Cannot transition from '{from_status}' to '{to_status}'"
        )
        self.from_status = from_status
        self.to_status = to_status


def can_transition(from_status: TicketStatus, to_status: TicketStatus) -> bool:
    """Check whether transitioning between statuses is valid."""
    if from_status == to_status:
        return True
    return to_status in VALID_TRANSITIONS.get(from_status, [])


def validate_transition(
    from_status: TicketStatus, to_status: TicketStatus
) -> None:
    """Raise :class:`InvalidTransitionError` if the transition is invalid."""
    if not can_transition(from_status, to_status):
        raise InvalidTransitionError(from_status, to_status)


# ── Backward-transition helpers ─────────────────────────────────

_STATE_ORDER: list[TicketStatus] = [
    "idea",
    "product-design",
    "technical-design",
    "amend-specs",
    "implementation-plan",
    "implementing",
    "done",
]


def is_backward_transition(from_status: TicketStatus, to_status: TicketStatus) -> bool:
    """True iff the transition moves earlier in the canonical order."""
    return _STATE_ORDER.index(to_status) < _STATE_ORDER.index(from_status)


# ── Skip-aware helpers ──────────────────────────────────────────


def next_unskipped_status(
    current: TicketStatus,
    skipped: list[TicketStatus],
) -> TicketStatus:
    """Walk forward through _STATE_ORDER from ``current`` + 1, returning
    the first phase not in ``skipped``. If we walk off the end (or are
    already at 'done'), return 'done'."""
    skipped_set = set(skipped)
    try:
        i = _STATE_ORDER.index(current)
    except ValueError:
        return "done"
    for j in range(i + 1, len(_STATE_ORDER)):
        candidate = _STATE_ORDER[j]
        if candidate not in skipped_set:
            return candidate
    return "done"


_SKIPPABLE: frozenset[TicketStatus] = frozenset({
    "product-design",
    "technical-design",
    "amend-specs",
    "implementation-plan",
    "implementing",
})


def is_skippable(status: TicketStatus) -> bool:
    """True for phases that may be skipped via the vertical phase list.
    Excludes 'idea' (start state, no work) and 'done' (terminal)."""
    return status in _SKIPPABLE
