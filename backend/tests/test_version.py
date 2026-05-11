"""Tests for app.version comparison logic."""
from __future__ import annotations

import pytest

from app.version import _normalize, is_newer


class TestIsNewer:
    def test_basic_patch_bump(self):
        assert is_newer("0.2.1", "0.2.0")
        assert not is_newer("0.2.0", "0.2.1")

    def test_minor_and_major(self):
        assert is_newer("0.3.0", "0.2.5")
        assert is_newer("1.0.0", "0.9.99")

    def test_equal_is_not_newer(self):
        assert not is_newer("0.2.0", "0.2.0")
        assert not is_newer("0.2.0-nightly.5", "0.2.0-nightly.5")

    def test_stable_is_newer_than_its_prerelease(self):
        assert is_newer("0.2.0", "0.2.0-nightly.5")
        assert not is_newer("0.2.0-nightly.5", "0.2.0")

    def test_nightly_counter(self):
        assert is_newer("0.2.0-nightly.10", "0.2.0-nightly.9")
        assert not is_newer("0.2.0-nightly.9", "0.2.0-nightly.10")

    def test_nightly_across_bases(self):
        assert is_newer("0.3.0-nightly.1", "0.2.0-nightly.99")

    def test_malformed_versions_return_false(self):
        assert not is_newer("0.2", "0.1.0")
        assert not is_newer("0.2.0", "garbage")
        assert not is_newer("v0.2.0", "0.1.0")


class TestNormalize:
    @pytest.mark.parametrize("version", ["0.2.0", "0.0.0", "1.4.7", "99.99.99"])
    def test_stable_versions_normalize(self, version):
        assert _normalize(version) is not None

    @pytest.mark.parametrize("version", ["0.2.0-nightly.1", "0.0.0-nightly.99", "1.4.7-nightly.0"])
    def test_nightly_versions_normalize(self, version):
        assert _normalize(version) is not None

    @pytest.mark.parametrize("version", ["", "v0.2.0", "0.2", "0.2.0-beta.1", "0.2.0-nightly", "garbage"])
    def test_invalid_versions_return_none(self, version):
        assert _normalize(version) is None
