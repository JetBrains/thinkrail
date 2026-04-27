"""Tests for the frontmatter module — YAML parsing, serialization, and validation."""

from __future__ import annotations

import pytest

from app.spec.frontmatter import (
    FrontmatterError,
    extract_links,
    parse_frontmatter,
    serialize_frontmatter,
    update_frontmatter,
    validate_frontmatter,
)


# ── Fixtures ─────────────────────────────────────────────────────────────────

FULL_SPEC = """\
---
id: module-spec
type: module-design
status: active
title: Spec Module
parent: design-doc
depends-on:
  - goal-and-requirements
references:
  - module-core
implements:
  - goal-and-requirements
covers:
  - backend/app/spec/
tags:
  - backend
  - core-domain
priority: high
---
# Spec Module — Design Specification

The Spec module is the core domain layer of Bonsai...
"""

MINIMAL_SPEC = """\
---
id: task-fix
type: task-spec
---
# Fix the bug

Some content here.
"""

NO_FRONTMATTER = """\
# Just a Markdown File

No frontmatter at all.
"""

EMPTY_FRONTMATTER = """\
---
---
# Empty frontmatter

Body is here.
"""


# ── TestParseFrontmatter ─────────────────────────────────────────────────────


class TestParseFrontmatter:
    def test_parses_full_spec(self) -> None:
        meta, body = parse_frontmatter(FULL_SPEC)
        assert meta["id"] == "module-spec"
        assert meta["type"] == "module-design"
        assert meta["status"] == "active"
        assert meta["title"] == "Spec Module"
        assert meta["parent"] == "design-doc"
        assert meta["depends-on"] == ["goal-and-requirements"]
        assert meta["references"] == ["module-core"]
        assert meta["implements"] == ["goal-and-requirements"]
        assert meta["covers"] == ["backend/app/spec/"]
        assert meta["tags"] == ["backend", "core-domain"]
        assert meta["priority"] == "high"  # custom field preserved
        assert body.startswith("# Spec Module")

    def test_parses_minimal_spec(self) -> None:
        meta, body = parse_frontmatter(MINIMAL_SPEC)
        assert meta["id"] == "task-fix"
        assert meta["type"] == "task-spec"
        assert "status" not in meta
        assert body.startswith("# Fix the bug")

    def test_no_frontmatter_returns_empty_dict(self) -> None:
        meta, body = parse_frontmatter(NO_FRONTMATTER)
        assert meta == {}
        assert body == NO_FRONTMATTER

    def test_empty_frontmatter_returns_empty_dict(self) -> None:
        meta, body = parse_frontmatter(EMPTY_FRONTMATTER)
        assert meta == {}
        assert "# Empty frontmatter" in body

    def test_malformed_yaml_raises_error(self) -> None:
        text = "---\nid: [unclosed bracket\n---\n# Content\n"
        with pytest.raises(FrontmatterError, match="Malformed YAML"):
            parse_frontmatter(text)

    def test_non_dict_yaml_raises_error(self) -> None:
        text = "---\n- item1\n- item2\n---\n# Content\n"
        with pytest.raises(FrontmatterError, match="must be a YAML mapping"):
            parse_frontmatter(text)

    def test_single_delimiter_returns_no_frontmatter(self) -> None:
        text = "---\nid: my-spec\ntype: task-spec\n# No closing delimiter\n"
        meta, body = parse_frontmatter(text)
        assert meta == {}
        assert body == text

    def test_preserves_body_exactly(self) -> None:
        body_content = "# Title\n\nParagraph with **bold** and `code`.\n\n- Item 1\n- Item 2\n"
        text = f"---\nid: test\ntype: task-spec\n---\n{body_content}"
        meta, body = parse_frontmatter(text)
        assert body == body_content

    def test_leading_newlines_before_frontmatter(self) -> None:
        text = "\n\n---\nid: test\ntype: task-spec\n---\n# Content\n"
        meta, body = parse_frontmatter(text)
        assert meta["id"] == "test"

    def test_custom_fields_preserved(self) -> None:
        text = "---\nid: test\ntype: task-spec\ncustom_key: custom_value\npriority: high\n---\n# Content\n"
        meta, body = parse_frontmatter(text)
        assert meta["custom_key"] == "custom_value"
        assert meta["priority"] == "high"


# ── TestSerializeFrontmatter ─────────────────────────────────────────────────


class TestSerializeFrontmatter:
    def test_serializes_minimal(self) -> None:
        meta = {"id": "test", "type": "task-spec"}
        body = "# Test\n\nContent.\n"
        result = serialize_frontmatter(meta, body)
        assert result.startswith("---\n")
        assert "\nid: test\n" in result
        assert "\ntype: task-spec\n" in result
        assert result.endswith("Content.\n")

    def test_serializes_with_lists(self) -> None:
        meta = {
            "id": "test",
            "type": "module-design",
            "tags": ["backend", "core"],
            "covers": ["src/foo/"],
        }
        result = serialize_frontmatter(meta, "# Content\n")
        assert "tags:" in result
        assert "- backend" in result
        assert "- core" in result

    def test_canonical_key_order(self) -> None:
        # Keys should appear in canonical order regardless of input order.
        meta = {
            "tags": ["a"],
            "id": "test",
            "custom_field": "value",
            "type": "task-spec",
            "status": "draft",
        }
        result = serialize_frontmatter(meta, "")
        lines = result.split("\n")
        # Find positions of keys in output
        key_lines = [l for l in lines if ":" in l and not l.startswith("---") and not l.startswith("-")]
        keys = [l.split(":")[0].strip() for l in key_lines]
        assert keys.index("id") < keys.index("type")
        assert keys.index("type") < keys.index("status")
        assert keys.index("status") < keys.index("tags")
        assert keys.index("tags") < keys.index("custom_field")

    def test_empty_body(self) -> None:
        meta = {"id": "test", "type": "task-spec"}
        result = serialize_frontmatter(meta, "")
        assert result.endswith("\n")
        # Should have exactly: ---\n<yaml>\n---\n
        assert result.count("---") == 2

    def test_preserves_custom_fields(self) -> None:
        meta = {"id": "test", "type": "task-spec", "priority": "high", "sprint": 3}
        result = serialize_frontmatter(meta, "# Content\n")
        assert "priority: high" in result
        assert "sprint: 3" in result


# ── TestRoundTrip ────────────────────────────────────────────────────────────


class TestRoundTrip:
    def test_serialize_then_parse_minimal(self) -> None:
        meta_in = {"id": "test", "type": "task-spec"}
        body_in = "# My Spec\n\nSome content.\n"
        text = serialize_frontmatter(meta_in, body_in)
        meta_out, body_out = parse_frontmatter(text)
        assert meta_out == meta_in
        assert body_out == body_in

    def test_serialize_then_parse_full(self) -> None:
        meta_in = {
            "id": "module-spec",
            "type": "module-design",
            "status": "active",
            "title": "Spec Module",
            "parent": "design-doc",
            "depends-on": ["goal-and-requirements"],
            "references": ["module-core"],
            "implements": ["goal-and-requirements"],
            "covers": ["backend/app/spec/"],
            "tags": ["backend", "core-domain"],
            "priority": "high",
        }
        body_in = "# Spec Module\n\nThe core domain layer.\n"
        text = serialize_frontmatter(meta_in, body_in)
        meta_out, body_out = parse_frontmatter(text)
        assert meta_out == meta_in
        assert body_out == body_in

    def test_roundtrip_preserves_body_whitespace(self) -> None:
        # Body should not start with leading newlines — the serializer adds
        # a newline between ``---`` and body, and the parser strips it.
        body = "# Title\n\n  indented paragraph\n\n```python\ndef foo():\n    pass\n```\n"
        meta = {"id": "test", "type": "task-spec"}
        text = serialize_frontmatter(meta, body)
        _, body_out = parse_frontmatter(text)
        assert body_out == body


# ── TestUpdateFrontmatter ────────────────────────────────────────────────────


class TestUpdateFrontmatter:
    def test_updates_existing_field(self) -> None:
        text = "---\nid: test\ntype: task-spec\nstatus: draft\n---\n# Content\n"
        result = update_frontmatter(text, {"status": "active"})
        meta, body = parse_frontmatter(result)
        assert meta["status"] == "active"
        assert meta["id"] == "test"
        assert "# Content" in body

    def test_adds_new_field(self) -> None:
        text = "---\nid: test\ntype: task-spec\n---\n# Content\n"
        result = update_frontmatter(text, {"tags": ["backend"]})
        meta, _ = parse_frontmatter(result)
        assert meta["tags"] == ["backend"]

    def test_preserves_body_exactly(self) -> None:
        body = "# Title\n\n  Indented line.\n\n```code block```\n"
        text = f"---\nid: test\ntype: task-spec\n---\n{body}"
        result = update_frontmatter(text, {"status": "active"})
        _, body_out = parse_frontmatter(result)
        assert body_out == body

    def test_creates_frontmatter_when_none_exists(self) -> None:
        text = "# Just content\n\nNo frontmatter.\n"
        result = update_frontmatter(text, {"id": "new-spec", "type": "task-spec"})
        meta, body = parse_frontmatter(result)
        assert meta["id"] == "new-spec"
        assert meta["type"] == "task-spec"
        assert "# Just content" in body


# ── TestExtractLinks ─────────────────────────────────────────────────────────


class TestExtractLinks:
    def test_extracts_parent(self) -> None:
        links = extract_links({"parent": "design-doc"})
        assert links == [("parent", "design-doc")]

    def test_extracts_depends_on_list(self) -> None:
        links = extract_links({"depends-on": ["a", "b", "c"]})
        assert links == [("depends-on", "a"), ("depends-on", "b"), ("depends-on", "c")]

    def test_extracts_single_string_depends_on(self) -> None:
        links = extract_links({"depends-on": "single-dep"})
        assert links == [("depends-on", "single-dep")]

    def test_extracts_all_link_types(self) -> None:
        meta = {
            "parent": "p",
            "depends-on": ["d1"],
            "references": ["r1", "r2"],
            "implements": "i1",
        }
        links = extract_links(meta)
        assert ("parent", "p") in links
        assert ("depends-on", "d1") in links
        assert ("references", "r1") in links
        assert ("references", "r2") in links
        assert ("implements", "i1") in links
        assert len(links) == 5

    def test_no_link_fields_returns_empty(self) -> None:
        links = extract_links({"id": "test", "type": "task-spec"})
        assert links == []

    def test_none_values_skipped(self) -> None:
        links = extract_links({"parent": None, "depends-on": None})
        assert links == []

    def test_empty_strings_skipped(self) -> None:
        links = extract_links({"parent": "", "depends-on": ["", "valid"]})
        assert links == [("depends-on", "valid")]


# ── TestValidateFrontmatter ──────────────────────────────────────────────────


class TestValidateFrontmatter:
    def test_valid_minimal(self) -> None:
        errors = validate_frontmatter({"id": "test", "type": "task-spec"})
        assert errors == []

    def test_valid_full(self) -> None:
        meta = {
            "id": "module-spec",
            "type": "module-design",
            "status": "active",
            "title": "Spec Module",
            "parent": "design-doc",
            "depends-on": ["a"],
            "covers": ["src/"],
            "tags": ["backend"],
        }
        errors = validate_frontmatter(meta)
        assert errors == []

    def test_missing_id(self) -> None:
        errors = validate_frontmatter({"type": "task-spec"})
        assert any("'id'" in e for e in errors)

    def test_empty_id(self) -> None:
        errors = validate_frontmatter({"id": "", "type": "task-spec"})
        assert any("'id'" in e for e in errors)

    def test_missing_type(self) -> None:
        errors = validate_frontmatter({"id": "test"})
        assert any("'type'" in e for e in errors)

    def test_invalid_type(self) -> None:
        errors = validate_frontmatter({"id": "test", "type": "invalid-type"})
        assert any("Unrecognized spec type" in e for e in errors)

    def test_invalid_status(self) -> None:
        errors = validate_frontmatter({"id": "test", "type": "task-spec", "status": "bogus"})
        assert any("Invalid status" in e for e in errors)

    def test_valid_statuses(self) -> None:
        for status in ("draft", "active", "stale", "done", "deprecated"):
            errors = validate_frontmatter({"id": "test", "type": "task-spec", "status": status})
            assert errors == [], f"Status '{status}' should be valid"

    def test_covers_must_be_list(self) -> None:
        errors = validate_frontmatter({"id": "t", "type": "task-spec", "covers": "not-a-list"})
        assert any("'covers' must be a list" in e for e in errors)

    def test_tags_must_be_list(self) -> None:
        errors = validate_frontmatter({"id": "t", "type": "task-spec", "tags": "not-a-list"})
        assert any("'tags' must be a list" in e for e in errors)

    def test_link_field_wrong_type(self) -> None:
        errors = validate_frontmatter({"id": "t", "type": "task-spec", "parent": 42})
        assert any("'parent' must be a string" in e for e in errors)

    def test_link_field_list_with_non_string(self) -> None:
        errors = validate_frontmatter({"id": "t", "type": "task-spec", "depends-on": [1, "ok"]})
        assert any("'depends-on[0]' must be a string" in e for e in errors)

    def test_custom_fields_not_validated(self) -> None:
        # Custom fields should not cause errors
        errors = validate_frontmatter({"id": "t", "type": "task-spec", "priority": "high", "sprint": 3})
        assert errors == []

    def test_multiple_errors_returned(self) -> None:
        errors = validate_frontmatter({})
        assert len(errors) >= 2  # at least missing id and missing type
