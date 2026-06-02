from __future__ import annotations

from app.agent.todo_snapshot import derive_todo_snapshot, is_todo_event


def _toolcall(name: str, **inp) -> dict:
    return {"eventType": "toolCallStart", "payload": {"toolName": name, "toolInput": inp}}


class TestTodoWrite:
    def test_full_replace_on_each_call(self) -> None:
        out = derive_todo_snapshot([
            _toolcall("TodoWrite", todos=[
                {"id": "a", "content": "Alpha", "status": "pending"},
                {"id": "b", "content": "Beta", "status": "pending"},
            ]),
            _toolcall("TodoWrite", todos=[
                {"id": "a", "content": "Alpha", "status": "in_progress"},
                {"id": "c", "content": "Gamma", "status": "pending"},
            ]),
        ])
        # Second call replaces the list — Beta is gone, Gamma is in.
        assert [t["key"] for t in out] == ["a", "c"]
        assert out[0]["status"] == "in_progress"


class TestTaskCreateUpdate:
    def test_create_assigns_sequential_keys(self) -> None:
        out = derive_todo_snapshot([
            _toolcall("TaskCreate", subject="First"),
            _toolcall("TaskCreate", subject="Second", activeForm="Doing second"),
        ])
        assert [t["key"] for t in out] == ["1", "2"]
        assert out[0]["status"] == "pending"
        assert out[0]["content"] == "First"

    def test_update_status_to_in_progress_uses_active_form(self) -> None:
        out = derive_todo_snapshot([
            _toolcall("TaskCreate", subject="Run tests", activeForm="Running tests"),
            _toolcall("TaskUpdate", taskId="1", status="in_progress"),
        ])
        assert out[0]["status"] == "in_progress"
        assert out[0]["content"] == "Running tests"

    def test_update_completed_keeps_subject(self) -> None:
        out = derive_todo_snapshot([
            _toolcall("TaskCreate", subject="Lint", activeForm="Linting"),
            _toolcall("TaskUpdate", taskId="1", status="completed"),
        ])
        assert out[0]["status"] == "completed"
        assert out[0]["content"] == "Lint"

    def test_deleted_removes_from_list(self) -> None:
        out = derive_todo_snapshot([
            _toolcall("TaskCreate", subject="A"),
            _toolcall("TaskCreate", subject="B"),
            _toolcall("TaskUpdate", taskId="1", status="deleted"),
        ])
        assert [t["key"] for t in out] == ["2"]


class TestIsTodoEvent:
    def test_recognises_todo_tools(self) -> None:
        assert is_todo_event(_toolcall("TodoWrite", todos=[]))
        assert is_todo_event(_toolcall("TaskCreate"))
        assert is_todo_event(_toolcall("TaskUpdate"))

    def test_other_tool_calls_are_not_todo_events(self) -> None:
        assert not is_todo_event(_toolcall("Read", file_path="x.md"))
        assert not is_todo_event({"eventType": "assistantMessage", "payload": {}})


class TestEmpty:
    def test_no_events_returns_empty_list(self) -> None:
        assert derive_todo_snapshot([]) == []

    def test_non_task_events_ignored(self) -> None:
        assert derive_todo_snapshot([
            {"eventType": "assistantMessage", "payload": {}},
            _toolcall("Bash", command="ls"),
        ]) == []
