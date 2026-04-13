"""Tests for token-based authentication."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.rpc.auth import (
    ANONYMOUS,
    UserIdentity,
    authenticate,
    generate_token,
    load_users,
    save_user,
)


def _write_users(tmp_path: Path, data: dict) -> None:
    bonsai = tmp_path / ".bonsai"
    bonsai.mkdir(exist_ok=True)
    (bonsai / "users.json").write_text(json.dumps(data), encoding="utf-8")


class TestGenerateToken:
    def test_has_prefix(self) -> None:
        token = generate_token()
        assert token.startswith("bns_")

    def test_sufficient_entropy(self) -> None:
        token = generate_token()
        # bns_ + 32 hex chars = 36 total
        assert len(token) == 36

    def test_unique(self) -> None:
        tokens = {generate_token() for _ in range(100)}
        assert len(tokens) == 100


class TestLoadUsers:
    def test_no_file_creates_default_and_returns_empty_allow_anon(self, tmp_path: Path) -> None:
        token_map, allow_anon = load_users(tmp_path)
        assert token_map == {}
        assert allow_anon is True
        assert (tmp_path / ".bonsai" / "users.json").is_file()

    def test_loads_users(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [
                {"id": "alice", "name": "Alice", "token": "bns_aaa"},
                {"id": "bob", "name": "Bob", "token": "bns_bbb"},
            ],
            "allowAnonymous": False,
        })
        token_map, allow_anon = load_users(tmp_path)
        assert len(token_map) == 2
        assert token_map["bns_aaa"].user_id == "alice"
        assert token_map["bns_aaa"].display_name == "Alice"
        assert token_map["bns_bbb"].user_id == "bob"
        assert allow_anon is False

    def test_defaults_allow_anonymous_true(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {"users": []})
        _, allow_anon = load_users(tmp_path)
        assert allow_anon is True

    def test_skips_entries_without_token_or_id(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [
                {"id": "valid", "name": "V", "token": "bns_v"},
                {"id": "", "name": "NoId", "token": "bns_noid"},
                {"id": "notoken", "name": "NoToken", "token": ""},
            ],
        })
        token_map, _ = load_users(tmp_path)
        assert len(token_map) == 1
        assert "bns_v" in token_map

    def test_malformed_json_returns_empty(self, tmp_path: Path) -> None:
        bonsai = tmp_path / ".bonsai"
        bonsai.mkdir()
        (bonsai / "users.json").write_text("not json", encoding="utf-8")
        token_map, allow_anon = load_users(tmp_path)
        assert token_map == {}
        assert allow_anon is True


class TestAuthenticate:
    def test_valid_token(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [{"id": "danya", "name": "Danya", "token": "bns_secret"}],
        })
        identity = authenticate(tmp_path, "bns_secret")
        assert identity is not None
        assert identity.user_id == "danya"
        assert identity.display_name == "Danya"

    def test_invalid_token_rejected(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [{"id": "danya", "name": "Danya", "token": "bns_secret"}],
        })
        identity = authenticate(tmp_path, "bns_wrong")
        assert identity is None

    def test_no_token_anonymous_allowed(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {"users": [], "allowAnonymous": True})
        identity = authenticate(tmp_path, None)
        assert identity is ANONYMOUS
        assert identity.user_id == "anonymous"

    def test_no_token_anonymous_disallowed(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {"users": [], "allowAnonymous": False})
        identity = authenticate(tmp_path, None)
        assert identity is None

    def test_no_users_file_allows_anonymous(self, tmp_path: Path) -> None:
        identity = authenticate(tmp_path, None)
        assert identity is ANONYMOUS

    def test_no_users_file_rejects_token(self, tmp_path: Path) -> None:
        # No users.json → empty token_map → token not found → rejected
        identity = authenticate(tmp_path, "bns_whatever")
        assert identity is None


class TestSaveUser:
    def test_creates_file(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai").mkdir()
        token = save_user(tmp_path, "alice", "Alice")
        assert token.startswith("bns_")

        data = json.loads((tmp_path / ".bonsai" / "users.json").read_text())
        assert len(data["users"]) == 1
        assert data["users"][0]["id"] == "alice"
        assert data["users"][0]["token"] == token

    def test_updates_existing_user(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [{"id": "alice", "name": "Alice", "token": "bns_old"}],
        })
        token = save_user(tmp_path, "alice", "Alice Updated")

        data = json.loads((tmp_path / ".bonsai" / "users.json").read_text())
        assert len(data["users"]) == 1
        assert data["users"][0]["name"] == "Alice Updated"
        assert data["users"][0]["token"] == token

    def test_adds_to_existing_users(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [{"id": "alice", "name": "Alice", "token": "bns_aaa"}],
        })
        save_user(tmp_path, "bob", "Bob")

        data = json.loads((tmp_path / ".bonsai" / "users.json").read_text())
        assert len(data["users"]) == 2

    def test_preserves_allow_anonymous(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {"users": [], "allowAnonymous": False})
        save_user(tmp_path, "alice", "Alice")

        data = json.loads((tmp_path / ".bonsai" / "users.json").read_text())
        assert data["allowAnonymous"] is False

    def test_custom_token(self, tmp_path: Path) -> None:
        (tmp_path / ".bonsai").mkdir()
        token = save_user(tmp_path, "alice", "Alice", token="bns_custom123")
        assert token == "bns_custom123"
