"""Tests for token-based authentication (server-wide + per-project fallback)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.server_store import ServerStore
from app.rpc.auth import (
    UserIdentity,
    authenticate,
    authenticate_rest,
    generate_token,
    _load_project_users,
)


def _write_users(tmp_path: Path, data: dict) -> None:
    bonsai = tmp_path / ".bonsai"
    bonsai.mkdir(exist_ok=True)
    (bonsai / "users.json").write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
async def store(tmp_path: Path):
    s = ServerStore(tmp_path / "server")
    await s.open()
    yield s
    await s.close()


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


class TestLoadProjectUsers:
    def test_no_file_creates_default_and_returns_empty(self, tmp_path: Path) -> None:
        token_map = _load_project_users(tmp_path)
        assert token_map == {}
        assert (tmp_path / ".bonsai" / "users.json").is_file()

    def test_loads_users(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [
                {"id": "alice", "name": "Alice", "token": "bns_aaa"},
                {"id": "bob", "name": "Bob", "token": "bns_bbb"},
            ],
        })
        token_map = _load_project_users(tmp_path)
        assert len(token_map) == 2
        assert token_map["bns_aaa"].user_id == "alice"
        assert token_map["bns_aaa"].display_name == "Alice"

    def test_skips_entries_without_token_or_id(self, tmp_path: Path) -> None:
        _write_users(tmp_path, {
            "users": [
                {"id": "valid", "name": "V", "token": "bns_v"},
                {"id": "", "name": "NoId", "token": "bns_noid"},
                {"id": "notoken", "name": "NoToken", "token": ""},
            ],
        })
        token_map = _load_project_users(tmp_path)
        assert len(token_map) == 1
        assert "bns_v" in token_map

    def test_malformed_json_returns_empty(self, tmp_path: Path) -> None:
        bonsai = tmp_path / ".bonsai"
        bonsai.mkdir()
        (bonsai / "users.json").write_text("not json", encoding="utf-8")
        token_map = _load_project_users(tmp_path)
        assert token_map == {}


class TestAuthenticate:
    async def test_server_wide_token(self, store: ServerStore, tmp_path: Path) -> None:
        await store.create_user("danya", "Danya")
        token = await store.create_token("danya")
        identity = await authenticate(store, tmp_path, token)
        assert identity is not None
        assert identity.user_id == "danya"
        assert identity.display_name == "Danya"

    async def test_invalid_token_rejected(self, store: ServerStore, tmp_path: Path) -> None:
        identity = await authenticate(store, tmp_path, "bns_wrong")
        assert identity is None

    async def test_no_token_rejected(self, store: ServerStore, tmp_path: Path) -> None:
        identity = await authenticate(store, tmp_path, None)
        assert identity is None

    async def test_empty_token_rejected(self, store: ServerStore, tmp_path: Path) -> None:
        identity = await authenticate(store, tmp_path, "")
        assert identity is None

    async def test_per_project_fallback_and_migration(self, store: ServerStore, tmp_path: Path) -> None:
        """Token in project users.json should work and be migrated to server store."""
        _write_users(tmp_path, {
            "users": [{"id": "alice", "name": "Alice", "token": "bns_projecttoken"}],
        })
        # Token not in server store yet
        assert await store.resolve_token("bns_projecttoken") is None

        identity = await authenticate(store, tmp_path, "bns_projecttoken")
        assert identity is not None
        assert identity.user_id == "alice"

        # Token should now be migrated to server store
        assert await store.resolve_token("bns_projecttoken") == "alice"
        user = await store.get_user("alice")
        assert user is not None
        assert user.display_name == "Alice"

    async def test_server_token_takes_priority(self, store: ServerStore, tmp_path: Path) -> None:
        """Server-wide token should resolve before checking project users.json."""
        await store.create_user("server_alice", "Server Alice")
        await store.register_token("bns_shared", "server_alice")

        _write_users(tmp_path, {
            "users": [{"id": "project_alice", "name": "Project Alice", "token": "bns_shared"}],
        })

        identity = await authenticate(store, tmp_path, "bns_shared")
        assert identity is not None
        assert identity.user_id == "server_alice"  # server wins


class TestAuthenticateRest:
    async def test_valid_token(self, store: ServerStore) -> None:
        await store.create_user("bob", "Bob")
        token = await store.create_token("bob")
        identity = await authenticate_rest(store, token)
        assert identity is not None
        assert identity.user_id == "bob"

    async def test_invalid_token(self, store: ServerStore) -> None:
        identity = await authenticate_rest(store, "bns_invalid")
        assert identity is None

    async def test_no_token(self, store: ServerStore) -> None:
        identity = await authenticate_rest(store, None)
        assert identity is None
