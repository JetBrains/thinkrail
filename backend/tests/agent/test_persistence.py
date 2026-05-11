import json
from pathlib import Path

from app.agent.persistence import (
    append_event,
    delete_session,
    has_persisted_sessions,
    list_sessions,
    load_session,
    save_session,
    update_session_metadata,
)


def _make_session_data(bonsai_sid: str = "task-1", **overrides) -> dict:
    base = {
        "bonsaiSid": bonsai_sid,
        "name": "test session",
        "skillId": "module-design",
        "specIds": ["spec-1"],
        "config": {"model": "claude-sonnet-4-6", "maxTurns": 25},
        "status": "done",
        "sessionId": "sess-abc",
        "createdAt": "2026-03-03T10:00:00Z",
        "updatedAt": "2026-03-03T10:05:00Z",
        "metrics": {},
    }
    base.update(overrides)
    return base


# -- save_session -------------------------------------------------------------


class TestSaveSession:
    def test_creates_metadata_file(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        meta = tmp_path / ".bonsai" / "sessions" / "task-1.json"
        assert meta.is_file()
        data = json.loads(meta.read_text())
        assert data["bonsaiSid"] == "task-1"
        assert "events" not in data

    def test_strips_events_to_jsonl(self, tmp_path: Path) -> None:
        events = [
            {"eventType": "sessionStart", "payload": {}},
            {"eventType": "textDelta", "payload": {"text": "hi"}},
        ]
        save_session(tmp_path, _make_session_data(events=events))

        meta = tmp_path / ".bonsai" / "sessions" / "task-1.json"
        assert "events" not in json.loads(meta.read_text())

        evts = tmp_path / ".bonsai" / "sessions" / "task-1.events.jsonl"
        assert evts.is_file()
        lines = [l for l in evts.read_text().splitlines() if l.strip()]
        assert len(lines) == 2
        assert json.loads(lines[0])["eventType"] == "sessionStart"

    def test_empty_bonsai_sid_noop(self, tmp_path: Path) -> None:
        save_session(tmp_path, {"bonsaiSid": ""})
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        assert not sessions_dir.exists() or not list(sessions_dir.iterdir())

    def test_creates_events_jsonl_without_events(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        evts = tmp_path / ".bonsai" / "sessions" / "task-1.events.jsonl"
        assert evts.is_file()
        assert evts.read_text() == ""

    def test_creates_sessions_dir(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        assert not sessions_dir.exists()
        save_session(tmp_path, _make_session_data())
        assert sessions_dir.is_dir()

    def test_backward_compat_taskId_key(self, tmp_path: Path) -> None:
        """Old-format data with 'taskId' key should still save correctly."""
        old_data = {
            "taskId": "old-task-1",
            "name": "old session",
            "specIds": [],
            "config": {},
            "status": "done",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        save_session(tmp_path, old_data)
        meta = tmp_path / ".bonsai" / "sessions" / "old-task-1.json"
        assert meta.is_file()
        data = json.loads(meta.read_text())
        assert data["bonsaiSid"] == "old-task-1"
        assert "taskId" not in data


# -- load_session --------------------------------------------------------------


class TestLoadSession:
    def test_combines_metadata_and_events(self, tmp_path: Path) -> None:
        events = [{"eventType": "done", "payload": {}}]
        save_session(tmp_path, _make_session_data(events=events))
        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert loaded["bonsaiSid"] == "task-1"
        assert loaded["events"] == events

    def test_missing_returns_none(self, tmp_path: Path) -> None:
        assert load_session(tmp_path, "nonexistent") is None

    def test_metadata_only_no_events(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert loaded["events"] == []

    def test_malformed_json_returns_none(self, tmp_path: Path) -> None:
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "bad.json").write_text("{broken", encoding="utf-8")
        assert load_session(tmp_path, "bad") is None

    def test_backward_compat_loads_old_taskId_key(self, tmp_path: Path) -> None:
        """Files with old 'taskId' key should load with 'bonsaiSid'."""
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        sessions_dir.mkdir(parents=True)
        old_meta = {"taskId": "old-1", "name": "old", "status": "done"}
        (sessions_dir / "old-1.json").write_text(json.dumps(old_meta))
        (sessions_dir / "old-1.events.jsonl").touch()
        loaded = load_session(tmp_path, "old-1")
        assert loaded is not None
        assert loaded["bonsaiSid"] == "old-1"
        assert "taskId" not in loaded


# -- list_sessions -------------------------------------------------------------


class TestListSessions:
    def test_returns_metadata_only(self, tmp_path: Path) -> None:
        events = [{"eventType": "textDelta", "payload": {"text": "hi"}}]
        save_session(tmp_path, _make_session_data("t1", events=events))
        save_session(tmp_path, _make_session_data("t2", events=events))
        result = list_sessions(tmp_path)
        assert len(result) == 2
        for entry in result:
            assert "events" not in entry

    def test_list_empty_dir(self, tmp_path: Path) -> None:
        assert list_sessions(tmp_path) == []

    def test_list_fields(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        result = list_sessions(tmp_path)
        assert len(result) == 1
        entry = result[0]
        expected_fields = {
            "bonsaiSid", "name", "skillId", "specIds", "status",
            "model", "createdAt", "updatedAt", "active", "inTracker", "metrics",
        }
        assert set(entry.keys()) == expected_fields

    def test_list_stale_status_corrected(self, tmp_path: Path) -> None:
        """Disk-only sessions with non-terminal status get forced to
        'interrupted' — the runner is gone (e.g., backend restart) but
        the UI should still treat the session as recoverable, not as a
        finished one."""
        save_session(tmp_path, _make_session_data(status="idle"))
        result = list_sessions(tmp_path)
        assert result[0]["status"] == "interrupted"
        assert result[0]["active"] is False

    def test_list_draft_status_preserved(self, tmp_path: Path) -> None:
        """Draft sessions keep their status even without a tracker entry."""
        save_session(tmp_path, _make_session_data(status="draft"))
        result = list_sessions(tmp_path)
        assert result[0]["status"] == "draft"


# -- append_event --------------------------------------------------------------


class TestAppendEvent:
    def test_creates_jsonl_file(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        append_event(tmp_path, "task-1", {"eventType": "textDelta", "payload": {}})
        evts = tmp_path / ".bonsai" / "sessions" / "task-1.events.jsonl"
        assert evts.is_file()
        lines = [l for l in evts.read_text().splitlines() if l.strip()]
        assert len(lines) == 1

    def test_adds_lines(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        for i in range(3):
            append_event(tmp_path, "task-1", {"eventType": f"event_{i}", "payload": {}})
        evts = tmp_path / ".bonsai" / "sessions" / "task-1.events.jsonl"
        lines = [l for l in evts.read_text().splitlines() if l.strip()]
        assert len(lines) == 3
        for i, line in enumerate(lines):
            assert json.loads(line)["eventType"] == f"event_{i}"

    def test_does_not_touch_metadata(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        meta = tmp_path / ".bonsai" / "sessions" / "task-1.json"
        original = meta.read_text()
        append_event(tmp_path, "task-1", {"eventType": "textDelta", "payload": {}})
        assert meta.read_text() == original

    def test_missing_session_noop(self, tmp_path: Path) -> None:
        # Should not raise or create any file
        append_event(tmp_path, "nonexistent", {"eventType": "x", "payload": {}})
        sessions_dir = tmp_path / ".bonsai" / "sessions"
        jsonl_files = list(sessions_dir.glob("*.events.jsonl")) if sessions_dir.exists() else []
        assert len(jsonl_files) == 0


# -- delete_session ------------------------------------------------------------


class TestDeleteSession:
    def test_removes_both_files(self, tmp_path: Path) -> None:
        events = [{"eventType": "done", "payload": {}}]
        save_session(tmp_path, _make_session_data(events=events))
        meta = tmp_path / ".bonsai" / "sessions" / "task-1.json"
        evts = tmp_path / ".bonsai" / "sessions" / "task-1.events.jsonl"
        assert meta.is_file() and evts.is_file()
        assert delete_session(tmp_path, "task-1") is True
        assert not meta.exists() and not evts.exists()

    def test_metadata_only(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        assert delete_session(tmp_path, "task-1") is True
        assert not (tmp_path / ".bonsai" / "sessions" / "task-1.json").exists()

    def test_nonexistent_returns_false(self, tmp_path: Path) -> None:
        assert delete_session(tmp_path, "nope") is False


# -- update_session_metadata ---------------------------------------------------


class TestUpdateSessionMetadata:
    def test_merges_incremental_metrics(self, tmp_path: Path) -> None:
        """update_session_metadata correctly merges metrics including toolCalls."""
        save_session(tmp_path, _make_session_data(metrics={
            "costUsd": 0, "turns": 0, "toolCalls": 0,
            "durationMs": 0, "contextTokens": 0,
        }))
        # Simulate incremental update (e.g. after a toolCallEnd)
        update_session_metadata(tmp_path, "task-1", {
            "metrics": {"costUsd": 0, "turns": 0, "toolCalls": 3, "durationMs": 1500},
        })
        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert loaded["metrics"]["toolCalls"] == 3
        assert loaded["metrics"]["durationMs"] == 1500

    def test_overwrites_metrics_by_default(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data(metrics={"costUsd": 0.5, "toolCalls": 2}))
        update_session_metadata(tmp_path, "task-1", {
            "metrics": {"costUsd": 1.0, "toolCalls": 5, "turns": 3},
        })
        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        # The entire metrics dict is replaced
        assert loaded["metrics"] == {"costUsd": 1.0, "toolCalls": 5, "turns": 3}

    def test_no_overwrite_preserves_existing(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data(metrics={"costUsd": 0.5}))
        update_session_metadata(tmp_path, "task-1", {"metrics": {"costUsd": 9.0}}, overwrite=False)
        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert loaded["metrics"]["costUsd"] == 0.5

    def test_missing_session_is_noop(self, tmp_path: Path) -> None:
        # Should not raise
        update_session_metadata(tmp_path, "nonexistent", {"metrics": {"toolCalls": 1}})


# -- round-trip ----------------------------------------------------------------


class TestRoundTrip:
    def test_save_load_roundtrip(self, tmp_path: Path) -> None:
        events = [
            {"eventType": "sessionStart", "payload": {}},
            {"eventType": "textDelta", "payload": {"text": "hello"}},
            {"eventType": "done", "payload": {"result": "ok"}},
        ]
        original = _make_session_data(events=events)
        save_session(tmp_path, dict(original))  # copy since save pops events

        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert loaded["bonsaiSid"] == "task-1"
        assert loaded["name"] == "test session"
        assert loaded["events"] == events

    def test_save_append_load_roundtrip(self, tmp_path: Path) -> None:
        initial_events = [{"eventType": "sessionStart", "payload": {}}]
        save_session(tmp_path, _make_session_data(events=initial_events))

        append_event(tmp_path, "task-1", {"eventType": "textDelta", "payload": {"text": "a"}})
        append_event(tmp_path, "task-1", {"eventType": "textDelta", "payload": {"text": "b"}})
        append_event(tmp_path, "task-1", {"eventType": "done", "payload": {}})

        loaded = load_session(tmp_path, "task-1")
        assert loaded is not None
        assert len(loaded["events"]) == 4
        assert loaded["events"][0]["eventType"] == "sessionStart"
        assert loaded["events"][1]["payload"]["text"] == "a"
        assert loaded["events"][2]["payload"]["text"] == "b"
        assert loaded["events"][3]["eventType"] == "done"


class TestHasPersistedSessions:
    def test_missing_dir_is_false(self, tmp_path: Path) -> None:
        assert has_persisted_sessions(tmp_path) is False

    def test_empty_sessions_dir_is_false(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai" / "sessions").mkdir(parents=True)
        assert has_persisted_sessions(tmp_path) is False

    def test_with_session_file_is_true(self, tmp_path: Path) -> None:
        save_session(tmp_path, _make_session_data())
        assert has_persisted_sessions(tmp_path) is True

