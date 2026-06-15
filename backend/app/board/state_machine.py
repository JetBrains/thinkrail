"""Stub — state machine was replaced by DAG-based ops in the current model.

Kept as a shim so legacy test imports compile. The actual transition logic
now lives in app.board.ops (apply_op on stage DAGs).
"""

from __future__ import annotations


class InvalidTransitionError(Exception):
    """Raised when a requested ticket status transition is invalid."""
