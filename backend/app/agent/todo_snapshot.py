"""Per-session TodoWrite/TaskCreate/TaskUpdate snapshot derivation.

The Bonsai frontend renders a "Tasks (n/m)" sub-row under each phase based
on the latest todo state emitted by the running agent. Historically that
derivation lived only in the frontend, walking the events of an
in-memory session — which meant the sub-row vanished after a reload until
the user re-opened the session.

This module owns the same logic on the backend so it can be persisted
into the session's metadata file and exposed through the session-list
RPC. Any frontend then reads a stable snapshot without having to load
events.jsonl. See `feedback_backend_comprehensive` memory for the
single-source-of-truth principle that motivates the move.

Supports two protocols from the agent SDK:

- `TodoWrite` (pre-v2.1.142): each call carries the full task list in
  ``toolInput.todos``. Each call REPLACES the snapshot.
- `TaskCreate` / `TaskUpdate` (SDK >= 0.2.83 default): incremental.
  ``TaskCreate`` adds one task with a sequential id ("1", "2", …);
  ``TaskUpdate`` mutates by ``taskId`` (or removes with
  ``status: "deleted"``).

The logic mirrors `frontend/src/components/TicketDetail/sessionTodoState.ts`
so the two derivations agree event-for-event.
"""
from __future__ import annotations

from typing import Any


def derive_todo_snapshot(events: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Return the latest task list from a session's events log.

    The returned list is ordered by creation order and each item has
    ``{key, content, status}``. Items in ``in_progress`` use their
    ``activeForm`` (if any) for ``content``; otherwise ``subject``.

    Returns an empty list when the session has emitted no task events.
    """
    tasks: dict[str, dict[str, str]] = {}
    ordered_keys: list[str] = []
    create_counter = 0

    for ev in events:
        if ev.get("eventType") != "toolCallStart":
            continue
        payload = ev.get("payload") or {}
        tool_name = payload.get("toolName")
        tool_input = payload.get("toolInput") or {}

        if tool_name == "TodoWrite":
            raw_todos = tool_input.get("todos")
            if not isinstance(raw_todos, list):
                continue
            tasks = {}
            ordered_keys = []
            for i, t in enumerate(raw_todos):
                if not isinstance(t, dict):
                    continue
                key = t.get("id") or t.get("content") or f"idx{i}"
                key = str(key)
                subject = t.get("content") or ""
                status = t.get("status") or "pending"
                tasks[key] = {
                    "key": key,
                    "subject": str(subject),
                    "activeForm": "",
                    "status": str(status),
                }
                ordered_keys.append(key)
            continue

        if tool_name == "TaskCreate":
            create_counter += 1
            key = str(create_counter)
            tasks[key] = {
                "key": key,
                "subject": str(tool_input.get("subject", "")),
                "activeForm": str(tool_input.get("activeForm", "")),
                "status": "pending",
            }
            ordered_keys.append(key)
            continue

        if tool_name == "TaskUpdate":
            key = tool_input.get("taskId")
            if not isinstance(key, str) or not key:
                continue
            item = tasks.get(key)
            if item is None:
                item = {"key": key, "subject": "", "activeForm": "", "status": "pending"}
                tasks[key] = item
                ordered_keys.append(key)
            status = tool_input.get("status")
            if status == "deleted":
                tasks.pop(key, None)
                ordered_keys = [k for k in ordered_keys if k != key]
                continue
            if isinstance(status, str) and status in ("pending", "in_progress", "completed"):
                item["status"] = status
            if isinstance(tool_input.get("subject"), str):
                item["subject"] = tool_input["subject"]
            if isinstance(tool_input.get("activeForm"), str):
                item["activeForm"] = tool_input["activeForm"]

    out: list[dict[str, str]] = []
    for k in ordered_keys:
        item = tasks.get(k)
        if item is None:
            continue
        content = (
            item["activeForm"]
            if item["status"] == "in_progress" and item["activeForm"]
            else item["subject"]
        )
        out.append({"key": item["key"], "content": content, "status": item["status"]})
    return out


_TODO_TOOLS = ("TodoWrite", "TaskCreate", "TaskUpdate")


def is_todo_event(event: dict[str, Any]) -> bool:
    """True when this event would change the todo snapshot."""
    if event.get("eventType") != "toolCallStart":
        return False
    payload = event.get("payload") or {}
    return payload.get("toolName") in _TODO_TOOLS


def new_snapshot_state() -> dict[str, Any]:
    """Empty in-memory state used by :func:`apply_todo_event`."""
    return {"tasks": {}, "ordered_keys": [], "create_counter": 0}


def build_snapshot_state(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Build mutable state from a full event log. Used on first load."""
    state = new_snapshot_state()
    for ev in events:
        if is_todo_event(ev):
            apply_todo_event(state, ev)
    return state


def render_snapshot(state: dict[str, Any]) -> list[dict[str, str]]:
    """Render the public snapshot shape from mutable state."""
    tasks: dict[str, dict[str, str]] = state["tasks"]
    out: list[dict[str, str]] = []
    for k in state["ordered_keys"]:
        item = tasks.get(k)
        if item is None:
            continue
        content = (
            item["activeForm"]
            if item["status"] == "in_progress" and item["activeForm"]
            else item["subject"]
        )
        out.append({"key": item["key"], "content": content, "status": item["status"]})
    return out


def apply_todo_event(state: dict[str, Any], event: dict[str, Any]) -> None:
    """Mutate ``state`` in place to reflect a single todo event.

    Mirrors the per-event logic in :func:`derive_todo_snapshot` so both
    derivations agree event-for-event.
    """
    payload = event.get("payload") or {}
    tool_name = payload.get("toolName")
    tool_input = payload.get("toolInput") or {}
    tasks: dict[str, dict[str, str]] = state["tasks"]
    ordered_keys: list[str] = state["ordered_keys"]

    if tool_name == "TodoWrite":
        raw_todos = tool_input.get("todos")
        if not isinstance(raw_todos, list):
            return
        tasks.clear()
        ordered_keys.clear()
        for i, t in enumerate(raw_todos):
            if not isinstance(t, dict):
                continue
            key = t.get("id") or t.get("content") or f"idx{i}"
            key = str(key)
            subject = t.get("content") or ""
            status = t.get("status") or "pending"
            tasks[key] = {
                "key": key,
                "subject": str(subject),
                "activeForm": "",
                "status": str(status),
            }
            ordered_keys.append(key)
        return

    if tool_name == "TaskCreate":
        state["create_counter"] += 1
        key = str(state["create_counter"])
        tasks[key] = {
            "key": key,
            "subject": str(tool_input.get("subject", "")),
            "activeForm": str(tool_input.get("activeForm", "")),
            "status": "pending",
        }
        ordered_keys.append(key)
        return

    if tool_name == "TaskUpdate":
        key = tool_input.get("taskId")
        if not isinstance(key, str) or not key:
            return
        item = tasks.get(key)
        if item is None:
            item = {"key": key, "subject": "", "activeForm": "", "status": "pending"}
            tasks[key] = item
            ordered_keys.append(key)
        status = tool_input.get("status")
        if status == "deleted":
            tasks.pop(key, None)
            state["ordered_keys"] = [k for k in ordered_keys if k != key]
            return
        if isinstance(status, str) and status in ("pending", "in_progress", "completed"):
            item["status"] = status
        if isinstance(tool_input.get("subject"), str):
            item["subject"] = tool_input["subject"]
        if isinstance(tool_input.get("activeForm"), str):
            item["activeForm"] = tool_input["activeForm"]
