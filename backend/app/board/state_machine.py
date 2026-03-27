from __future__ import annotations

from app.board.models import MetaTicketStatus

VALID_TRANSITIONS: dict[MetaTicketStatus, list[MetaTicketStatus]] = {
    "idea": ["specified", "done"],
    "specified": ["idea", "planned", "done"],
    "planned": ["specified", "executing", "done"],
    "executing": ["planned", "done"],
    "done": ["idea", "executing"],
}


class InvalidTransitionError(ValueError):
    """Raised when a status transition is not allowed."""

    def __init__(self, from_status: str, to_status: str) -> None:
        super().__init__(
            f"Cannot transition from '{from_status}' to '{to_status}'"
        )
        self.from_status = from_status
        self.to_status = to_status


def can_transition(from_status: MetaTicketStatus, to_status: MetaTicketStatus) -> bool:
    """Check whether transitioning between statuses is valid."""
    if from_status == to_status:
        return True
    return to_status in VALID_TRANSITIONS.get(from_status, [])


def validate_transition(
    from_status: MetaTicketStatus, to_status: MetaTicketStatus
) -> None:
    """Raise :class:`InvalidTransitionError` if the transition is invalid."""
    if not can_transition(from_status, to_status):
        raise InvalidTransitionError(from_status, to_status)
