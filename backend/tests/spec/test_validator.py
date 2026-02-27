from __future__ import annotations

import pytest

from app.spec.models import Link, RegistryEntry, Spec
from app.spec.validator import validate_links, validate_spec


def _entry(**overrides) -> RegistryEntry:
    defaults = dict(id="e1", type="module-design", path="a/README.md", title="Test")
    return RegistryEntry(**(defaults | overrides))


def _spec(**overrides) -> Spec:
    defaults = dict(type="module-design", content="# Hello")
    return Spec(**(defaults | overrides))


class TestValidateSpec:
    def test_valid_spec(self) -> None:
        errors = validate_spec(_spec(), _entry())
        assert errors == []

    def test_missing_id(self) -> None:
        errors = validate_spec(_spec(), _entry(id=""))
        assert any("missing 'id'" in e for e in errors)

    def test_unrecognized_type(self) -> None:
        errors = validate_spec(_spec(), _entry(type="banana"))
        assert any("Unrecognized spec type" in e for e in errors)

    def test_missing_path(self) -> None:
        errors = validate_spec(_spec(), _entry(path=""))
        assert any("missing 'path'" in e for e in errors)

    def test_missing_title(self) -> None:
        errors = validate_spec(_spec(), _entry(title=""))
        assert any("missing 'title'" in e for e in errors)

    def test_empty_content(self) -> None:
        errors = validate_spec(_spec(content=""), _entry())
        assert any("content is empty" in e for e in errors)


class TestValidateLinks:
    def test_valid_links(self) -> None:
        entries = [_entry(id="a"), _entry(id="b")]
        links = [Link(from_id="a", to_id="b", type="depends-on")]
        assert validate_links(links, entries) == []

    def test_self_link(self) -> None:
        entries = [_entry(id="a")]
        links = [Link(from_id="a", to_id="a", type="depends-on")]
        errors = validate_links(links, entries)
        assert any("Self-link" in e for e in errors)

    def test_missing_source(self) -> None:
        entries = [_entry(id="b")]
        links = [Link(from_id="ghost", to_id="b", type="parent")]
        errors = validate_links(links, entries)
        assert any("'ghost' not found" in e for e in errors)

    def test_missing_target(self) -> None:
        entries = [_entry(id="a")]
        links = [Link(from_id="a", to_id="ghost", type="parent")]
        errors = validate_links(links, entries)
        assert any("'ghost' not found" in e for e in errors)

    def test_unrecognized_link_type(self) -> None:
        entries = [_entry(id="a"), _entry(id="b")]
        links = [Link(from_id="a", to_id="b", type="banana")]
        errors = validate_links(links, entries)
        assert any("Unrecognized link type" in e for e in errors)
