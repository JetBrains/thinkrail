from __future__ import annotations

from pathlib import Path

import pytest

from app.board.patch import (
    AmendmentError,
    append_amendment,
    apply_amendment,
    extract_spec_id_for_link,
    parse_patch_log,
    validate_amended_file,
)


class TestApplyAmendment:
    def test_replaces_old_with_new(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("---\nid: foo\n---\n\n## Components\nFoo handles bar.\n")
        result = apply_amendment(
            project_root=tmp_path,
            file_path="spec.md",
            old_string="Foo handles bar.",
            new_string="Foo handles bar and baz.",
        )
        assert "Foo handles bar and baz." in result
        assert f.read_text() == result

    def test_errors_when_old_string_not_unique(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("dup\nmiddle\ndup\n")
        with pytest.raises(AmendmentError, match="not unique"):
            apply_amendment(
                project_root=tmp_path,
                file_path="spec.md",
                old_string="dup",
                new_string="new",
            )

    def test_errors_when_old_string_not_present(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("nothing here\n")
        with pytest.raises(AmendmentError, match="not found"):
            apply_amendment(
                project_root=tmp_path,
                file_path="spec.md",
                old_string="missing",
                new_string="new",
            )

    def test_errors_when_path_outside_project_root(self, tmp_path: Path) -> None:
        with pytest.raises(AmendmentError, match="outside project root"):
            apply_amendment(
                project_root=tmp_path,
                file_path="../escape.md",
                old_string="x",
                new_string="y",
            )

    def test_errors_when_file_does_not_exist(self, tmp_path: Path) -> None:
        with pytest.raises(AmendmentError, match="does not exist"):
            apply_amendment(
                project_root=tmp_path,
                file_path="missing.md",
                old_string="x",
                new_string="y",
            )


class TestValidateAmendedFile:
    def test_clean_markdown_returns_ok(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("---\nid: foo\n---\n\n## Header\nNo links here.\n")
        assert validate_amended_file(tmp_path, "spec.md") == []

    def test_broken_frontmatter_returns_warning(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("---\nid: foo\n  bad: [unclosed\n---\n\nbody\n")
        warnings = validate_amended_file(tmp_path, "spec.md")
        assert any(w["kind"] == "frontmatter" for w in warnings)

    def test_broken_link_returns_warning(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.md"
        f.write_text("See [Other](./nonexistent.md).\n")
        warnings = validate_amended_file(tmp_path, "spec.md")
        assert any(
            w["kind"] == "link" and "nonexistent.md" in w["message"]
            for w in warnings
        )

    def test_existing_relative_link_is_ok(self, tmp_path: Path) -> None:
        (tmp_path / "other.md").write_text("hi")
        (tmp_path / "spec.md").write_text("See [Other](./other.md).\n")
        assert validate_amended_file(tmp_path, "spec.md") == []

    def test_external_link_skipped(self, tmp_path: Path) -> None:
        (tmp_path / "spec.md").write_text("See [E](https://example.com).\n")
        assert validate_amended_file(tmp_path, "spec.md") == []


class TestAppendAmendment:
    def test_creates_log_with_first_amendment(self, tmp_path: Path) -> None:
        (tmp_path / ".tr" / "tickets" / "mt_x").mkdir(parents=True)
        log_path = append_amendment(
            project_root=tmp_path,
            ticket_id="mt_x",
            file_path=".tr/design_docs/MODULE_X.md",
            old_content="Foo handles bar.\n",
            new_content="Foo handles bar and baz.\n",
            spec_id="spec_abc",
            section="Components",
            rationale="add baz",
            applied_as="original",
            validation="ok",
            timestamp="2026-05-22T15:30:00Z",
        )
        text = log_path.read_text()
        assert "# == amendment 1 ==" in text
        assert "# spec_id:    spec_abc" in text
        assert "# section:    Components" in text
        assert "# rationale:  add baz" in text
        assert "# applied_as: original" in text
        assert "# validation: ok" in text
        assert "# timestamp:  2026-05-22T15:30:00Z" in text
        assert "--- a/.tr/design_docs/MODULE_X.md" in text
        assert "+++ b/.tr/design_docs/MODULE_X.md" in text
        assert "-Foo handles bar." in text
        assert "+Foo handles bar and baz." in text

    def test_appends_numbered_entries(self, tmp_path: Path) -> None:
        (tmp_path / ".tr" / "tickets" / "mt_x").mkdir(parents=True)
        kwargs: dict = dict(
            project_root=tmp_path, ticket_id="mt_x",
            file_path="f.md", old_content="a\n", new_content="b\n",
            spec_id=None, section=None, rationale=None,
            applied_as="original", validation="ok",
            timestamp="2026-05-22T15:30:00Z",
        )
        append_amendment(**kwargs)
        log_path = append_amendment(**kwargs)
        text = log_path.read_text()
        assert "# == amendment 1 ==" in text
        assert "# == amendment 2 ==" in text
        # No quadruple-blank-line drift
        assert "\n\n\n\n" not in text

    def test_optional_fields_render_none(self, tmp_path: Path) -> None:
        (tmp_path / ".tr" / "tickets" / "mt_x").mkdir(parents=True)
        log_path = append_amendment(
            project_root=tmp_path, ticket_id="mt_x", file_path="f.md",
            old_content="a\n", new_content="b\n",
            spec_id=None, section=None, rationale=None,
            applied_as="original", validation="ok",
            timestamp="2026-05-22T15:30:00Z",
        )
        text = log_path.read_text()
        assert "# spec_id:    (none)" in text
        assert "# section:    (none)" in text
        assert "# rationale:  (none)" in text


class TestParsePatchLog:
    """Round-trip via append_amendment so the parser sees the exact format
    the writer emits — including the newline immediately following the
    entry header line, which used to make the parser think the meta block
    had ended before it had begun."""

    def _write_two(self, tmp_path: Path) -> Path:
        (tmp_path / ".tr" / "tickets" / "mt_x").mkdir(parents=True)
        common: dict = dict(
            project_root=tmp_path, ticket_id="mt_x",
            file_path="f.md", old_content="a\n", new_content="b\n",
            spec_id=None, section="Goal", rationale="why",
            applied_as="original", validation="ok",
            timestamp="2026-05-22T15:30:00Z",
        )
        append_amendment(**{**common, "skill": "ticket-product-design"})
        append_amendment(**{**common, "skill": "ticket-amend-specs"})
        return tmp_path

    def test_recovers_skill_for_every_entry(self, tmp_path: Path) -> None:
        self._write_two(tmp_path)
        entries = parse_patch_log(tmp_path, "mt_x")
        assert len(entries) == 2
        # Regression: empty leading split element used to mark in_meta=False
        # before the # skill: line was parsed, dropping every meta field.
        assert entries[0]["skill"] == "ticket-product-design"
        assert entries[1]["skill"] == "ticket-amend-specs"
        assert entries[0]["section"] == "Goal"
        assert entries[0]["rationale"] == "why"


class TestExtractSpecIdForLink:
    def test_adds_spec_id_when_frontmatter_has_id(self, tmp_path: Path) -> None:
        (tmp_path / "spec.md").write_text("---\nid: spec_abc12\n---\n\nbody\n")
        assert extract_spec_id_for_link(tmp_path, "spec.md") == "spec_abc12"

    def test_returns_none_when_no_frontmatter(self, tmp_path: Path) -> None:
        (tmp_path / "spec.md").write_text("# Plain markdown\n")
        assert extract_spec_id_for_link(tmp_path, "spec.md") is None

    def test_returns_none_when_no_id_field(self, tmp_path: Path) -> None:
        (tmp_path / "spec.md").write_text("---\ntitle: thing\n---\n\nbody\n")
        assert extract_spec_id_for_link(tmp_path, "spec.md") is None

    def test_returns_none_when_file_missing(self, tmp_path: Path) -> None:
        assert extract_spec_id_for_link(tmp_path, "absent.md") is None
