from pathlib import Path

import pytest

from app.core.fileio import read_text, write_text, delete_file, ensure_dir


class TestReadText:
    def test_reads_file(self, tmp_path: Path) -> None:
        f = tmp_path / "hello.txt"
        f.write_text("hello world", encoding="utf-8")
        assert read_text(f) == "hello world"

    def test_raises_on_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            read_text(tmp_path / "nope.txt")


class TestWriteText:
    def test_writes_file(self, tmp_path: Path) -> None:
        f = tmp_path / "out.txt"
        write_text(f, "content")
        assert f.read_text(encoding="utf-8") == "content"

    def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        f = tmp_path / "a" / "b" / "out.txt"
        write_text(f, "deep")
        assert f.read_text(encoding="utf-8") == "deep"


class TestDeleteFile:
    def test_deletes_existing_file(self, tmp_path: Path) -> None:
        f = tmp_path / "doomed.txt"
        f.write_text("bye", encoding="utf-8")
        delete_file(f)
        assert not f.exists()

    def test_raises_on_missing_file(self, tmp_path: Path) -> None:
        with pytest.raises(FileNotFoundError):
            delete_file(tmp_path / "nope.txt")


class TestEnsureDir:
    def test_creates_directory(self, tmp_path: Path) -> None:
        d = tmp_path / "x" / "y" / "z"
        ensure_dir(d)
        assert d.is_dir()

    def test_idempotent(self, tmp_path: Path) -> None:
        d = tmp_path / "already"
        d.mkdir()
        ensure_dir(d)  # should not raise
        assert d.is_dir()
