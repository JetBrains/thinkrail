from __future__ import annotations

from pathlib import Path

from app.board.artifact_paths import (
    ARTIFACT_FILENAMES,
    artifact_path,
    ensure_ticket_dir,
    ticket_dir,
)


class TestTicketDir:
    def test_returns_under_dot_bonsai(self, tmp_path: Path) -> None:
        result = ticket_dir(tmp_path, "mt_abcd1234")
        assert result == tmp_path / ".bonsai" / "tickets" / "mt_abcd1234"


class TestArtifactPath:
    def test_product_design(self, tmp_path: Path) -> None:
        result = artifact_path(tmp_path, "mt_abcd1234", "product_design")
        assert result.name == "product-design.md"
        assert result.parent.name == "mt_abcd1234"

    def test_technical_design(self, tmp_path: Path) -> None:
        assert artifact_path(tmp_path, "mt_x", "technical_design").name == "technical-design.md"

    def test_history(self, tmp_path: Path) -> None:
        assert artifact_path(tmp_path, "mt_x", "history").name == "history.patch"

    def test_implementation_plan(self, tmp_path: Path) -> None:
        assert artifact_path(tmp_path, "mt_x", "implementation_plan").name == "implementation-plan.md"


class TestArtifactFilenames:
    def test_keys_match_artifact_kind_literal(self) -> None:
        assert set(ARTIFACT_FILENAMES) == {"product_design", "technical_design", "history", "implementation_plan"}


class TestEnsureTicketDir:
    def test_creates_missing_dir(self, tmp_path: Path) -> None:
        d = ensure_ticket_dir(tmp_path, "mt_new")
        assert d.is_dir()
        assert d == tmp_path / ".bonsai" / "tickets" / "mt_new"

    def test_idempotent(self, tmp_path: Path) -> None:
        ensure_ticket_dir(tmp_path, "mt_x")
        ensure_ticket_dir(tmp_path, "mt_x")
        assert (tmp_path / ".bonsai" / "tickets" / "mt_x").is_dir()
