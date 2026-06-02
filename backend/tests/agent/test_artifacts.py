from __future__ import annotations

from pathlib import Path

from app.agent.artifacts import label_artifact, record_artifact, set_preview
from app.agent.models import AgentConfig, AgentTask


def _task(ticket_id: str | None = "mt_x") -> AgentTask:
    return AgentTask(
        spec_ids=[],
        config=AgentConfig(),
        ticket_id=ticket_id,
    )


class TestRecordArtifact:
    def test_appends_new_entry(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        record_artifact(t, "x.md", "write", tmp_path)
        assert len(t.artifacts) == 1
        assert t.artifacts[0].path == "x.md"
        assert t.artifacts[0].kind == "write"
        assert t.artifacts[0].first_touched_at == t.artifacts[0].last_touched_at

    def test_updates_existing_entry_and_bumps_kind(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        record_artifact(t, "x.md", "write", tmp_path)
        first = t.artifacts[0].first_touched_at
        record_artifact(t, "x.md", "edit", tmp_path)
        assert len(t.artifacts) == 1
        assert t.artifacts[0].kind == "edit"
        assert t.artifacts[0].first_touched_at == first
        assert t.artifacts[0].last_touched_at >= first

    def test_no_op_outside_project_root(self, tmp_path: Path) -> None:
        t = _task()
        record_artifact(t, "../escape.md", "write", tmp_path)
        assert t.artifacts == []

    def test_no_op_when_not_ticket_linked(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task(ticket_id=None)
        record_artifact(t, "x.md", "write", tmp_path)
        assert t.artifacts == []


class TestLabelArtifact:
    def test_labels_existing_entry(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        record_artifact(t, "x.md", "write", tmp_path)
        label_artifact(t, "x.md", role="product_design", label="Product design")
        assert t.artifacts[0].role == "product_design"
        assert t.artifacts[0].label == "Product design"

    def test_no_op_for_unknown_path(self, tmp_path: Path) -> None:
        t = _task()
        label_artifact(t, "absent.md", role="x", label="X")
        assert t.artifacts == []

    def test_partial_update(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        record_artifact(t, "x.md", "write", tmp_path)
        label_artifact(t, "x.md", role=None, label="Only label")
        assert t.artifacts[0].role is None
        assert t.artifacts[0].label == "Only label"


class TestSetPreview:
    def test_sets_preview_and_adds_artifact_when_new(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        set_preview(t, "x.md", tmp_path)
        assert t.preview_path == "x.md"
        assert len(t.artifacts) == 1
        assert t.artifacts[0].kind == "preview"

    def test_does_not_duplicate_existing_artifact(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        record_artifact(t, "x.md", "write", tmp_path)
        set_preview(t, "x.md", tmp_path)
        assert t.preview_path == "x.md"
        assert len(t.artifacts) == 1
        assert t.artifacts[0].kind == "write"  # not downgraded to 'preview'

    def test_clears_preview_with_none(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task()
        set_preview(t, "x.md", tmp_path)
        set_preview(t, None, tmp_path)
        assert t.preview_path is None
        assert len(t.artifacts) == 1  # list NOT emptied

    def test_no_op_when_not_ticket_linked(self, tmp_path: Path) -> None:
        (tmp_path / "x.md").write_text("hi")
        t = _task(ticket_id=None)
        set_preview(t, "x.md", tmp_path)
        assert t.preview_path is None
        assert t.artifacts == []
