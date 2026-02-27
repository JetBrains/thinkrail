from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.spec.parser import parse_spec


class TestParseMarkdown:
    def test_parses_md_file(self, tmp_path: Path) -> None:
        md = tmp_path / "README.md"
        md.write_text("# My Spec\n\nSome content.", encoding="utf-8")
        spec = parse_spec(md)
        assert spec.content == "# My Spec\n\nSome content."
        assert spec.metadata is None
        assert spec.type == "module-design"

    def test_type_from_non_readme_md(self, tmp_path: Path) -> None:
        md = tmp_path / "design.md"
        md.write_text("# Design", encoding="utf-8")
        spec = parse_spec(md)
        assert spec.type == "design"


class TestParseJson:
    def test_parses_json_file(self, tmp_path: Path) -> None:
        data = {"version": "1.0", "items": [1, 2, 3]}
        jf = tmp_path / "config.json"
        jf.write_text(json.dumps(data), encoding="utf-8")
        spec = parse_spec(jf)
        assert spec.metadata == data
        assert spec.content == json.dumps(data)
        assert spec.type == "config"

    def test_malformed_json_raises(self, tmp_path: Path) -> None:
        jf = tmp_path / "bad.json"
        jf.write_text("{not valid json", encoding="utf-8")
        with pytest.raises(ValueError, match="Malformed JSON"):
            parse_spec(jf)


class TestParseTxt:
    def test_parses_txt_file(self, tmp_path: Path) -> None:
        txt = tmp_path / "feature_task.txt"
        txt.write_text("Implement something\n\nDetails here.", encoding="utf-8")
        spec = parse_spec(txt)
        assert spec.content == "Implement something\n\nDetails here."
        assert spec.metadata is None
        assert spec.type == "feature_task"


class TestErrors:
    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            parse_spec(tmp_path / "nope.md")

    def test_unsupported_extension_raises(self, tmp_path: Path) -> None:
        f = tmp_path / "spec.yaml"
        f.write_text("key: value", encoding="utf-8")
        with pytest.raises(ValueError, match="Unsupported spec file extension"):
            parse_spec(f)
