"""Tests for admin/* RPC method handlers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.core.server_store import ServerStore, User
from app.rpc.methods.admin import (
    admin_create_user,
    admin_delete_user,
    admin_list_users,
    admin_remove_admin,
    admin_revoke_token,
    admin_set_admin,
)


@pytest.fixture
async def store(tmp_path):
    s = ServerStore(tmp_path)
    await s.open()
    yield s
    await s.close()


def _mock_admin_context(user_id: str):
    """Mock current_conn_id and bus so the caller appears as the given user."""
    mock_conn = MagicMock()
    mock_conn.user_id = user_id

    return (
        patch("app.rpc.methods.admin.current_conn_id", MagicMock(get=MagicMock(return_value="fake-conn"))),
        patch("app.rpc.methods.admin.bus", MagicMock(get_connection=MagicMock(return_value=mock_conn))),
    )


class TestRequireAdmin:
    async def test_non_admin_rejected(self, store: ServerStore):
        """Non-admin user cannot call admin methods."""
        await store.create_user("regular", "Regular User")
        ctx1, ctx2 = _mock_admin_context("regular")
        with ctx1, ctx2:
            with pytest.raises(Exception, match="Admin access required"):
                await admin_list_users(store)

    async def test_admin_allowed(self, store: ServerStore):
        """Admin user can call admin methods."""
        await store.create_user("boss", "Boss", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("boss")
        with ctx1, ctx2:
            result = await admin_list_users(store)
            # Result is oslash.Right wrapping SuccessResult
            assert hasattr(result, "_value")


class TestAdminListUsers:
    async def test_returns_users_with_admin_and_token_count(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        await store.create_user("user1", "User")
        await store.create_token("admin1")
        await store.create_token("admin1")
        await store.create_token("user1")

        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_list_users(store)
            users = result._value.result["users"]
            assert len(users) == 2
            admin_entry = next(u for u in users if u["id"] == "admin1")
            assert admin_entry["isAdmin"] is True
            assert admin_entry["tokenCount"] == 2
            user_entry = next(u for u in users if u["id"] == "user1")
            assert user_entry["isAdmin"] is False
            assert user_entry["tokenCount"] == 1


class TestAdminCreateUser:
    async def test_creates_user_with_token(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_create_user(store, userId="newuser", name="New User")
            data = result._value.result
            assert data["userId"] == "newuser"
            assert data["token"].startswith("bns_")
            assert data["isAdmin"] is False

    async def test_creates_admin_user(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_create_user(store, userId="admin2", name="Admin 2", isAdmin=True)
            assert result._value.result["isAdmin"] is True


class TestAdminDeleteUser:
    async def test_deletes_user(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        await store.create_user("victim", "Victim")
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_delete_user(store, userId="victim")
            assert result._value.result["ok"] is True
        assert await store.get_user("victim") is None

    async def test_cannot_delete_last_admin(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            with pytest.raises(Exception, match="Cannot delete the last admin"):
                await admin_delete_user(store, userId="admin1")

    async def test_can_delete_admin_if_not_last(self, store: ServerStore):
        await store.create_user("admin1", "Admin 1", is_admin=True)
        await store.create_user("admin2", "Admin 2", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_delete_user(store, userId="admin2")
            assert result._value.result["ok"] is True


class TestAdminSetAdmin:
    async def test_grants_admin(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        await store.create_user("user1", "User")
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_set_admin(store, userId="user1")
            assert result._value.result["ok"] is True
        user = await store.get_user("user1")
        assert user is not None and user.is_admin is True


class TestAdminRemoveAdmin:
    async def test_revokes_admin(self, store: ServerStore):
        await store.create_user("admin1", "Admin 1", is_admin=True)
        await store.create_user("admin2", "Admin 2", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_remove_admin(store, userId="admin2")
            assert result._value.result["ok"] is True
        user = await store.get_user("admin2")
        assert user is not None and user.is_admin is False

    async def test_cannot_remove_last_admin(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            with pytest.raises(Exception, match="Cannot remove the last admin"):
                await admin_remove_admin(store, userId="admin1")


class TestAdminRevokeToken:
    async def test_revokes_existing_token(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        token = await store.create_token("admin1")
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            result = await admin_revoke_token(store, token=token)
            assert result._value.result["ok"] is True
        assert await store.resolve_token(token) is None

    async def test_rejects_nonexistent_token(self, store: ServerStore):
        await store.create_user("admin1", "Admin", is_admin=True)
        ctx1, ctx2 = _mock_admin_context("admin1")
        with ctx1, ctx2:
            with pytest.raises(Exception, match="Token not found"):
                await admin_revoke_token(store, token="bns_doesnotexist")
