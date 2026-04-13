"""Tests for ServerStore (SQLite-backed server-level storage)."""

import pytest
from pathlib import Path

from app.core.server_store import ServerStore


@pytest.fixture
async def store(tmp_path: Path):
    s = ServerStore(tmp_path)
    await s.open()
    yield s
    await s.close()


# -- users ------------------------------------------------------------------

class TestUsers:
    async def test_create_and_get(self, store: ServerStore):
        user = await store.create_user("alice", "Alice")
        assert user.id == "alice"
        assert user.display_name == "Alice"

        fetched = await store.get_user("alice")
        assert fetched is not None
        assert fetched.display_name == "Alice"

    async def test_get_nonexistent(self, store: ServerStore):
        assert await store.get_user("nobody") is None

    async def test_ensure_user_creates(self, store: ServerStore):
        user = await store.ensure_user("bob", "Bob")
        assert user.id == "bob"

    async def test_ensure_user_returns_existing(self, store: ServerStore):
        await store.create_user("carol", "Carol")
        user = await store.ensure_user("carol", "Carol Updated")
        assert user.display_name == "Carol"  # original name preserved

    async def test_list_users(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.create_user("bob", "Bob")
        users = await store.list_users()
        assert [u.id for u in users] == ["alice", "bob"]


# -- tokens -----------------------------------------------------------------

class TestTokens:
    async def test_create_and_resolve(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        token = await store.create_token("alice")
        assert token.startswith("bns_")
        assert len(token) == 4 + 32  # "bns_" + 16 hex bytes

        user_id = await store.resolve_token(token)
        assert user_id == "alice"

    async def test_resolve_invalid(self, store: ServerStore):
        assert await store.resolve_token("bns_invalid") is None

    async def test_revoke(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        token = await store.create_token("alice")
        await store.revoke_token(token)
        assert await store.resolve_token(token) is None

    async def test_list_tokens(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        t1 = await store.create_token("alice")
        t2 = await store.create_token("alice")
        tokens = await store.list_tokens("alice")
        assert len(tokens) == 2
        assert {t.token for t in tokens} == {t1, t2}

    async def test_register_token_migration(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.register_token("bns_migrated123456789012345678", "alice")
        user_id = await store.resolve_token("bns_migrated123456789012345678")
        assert user_id == "alice"

    async def test_register_token_idempotent(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.register_token("bns_dup12345678901234567890", "alice")
        await store.register_token("bns_dup12345678901234567890", "alice")  # no error
        tokens = await store.list_tokens("alice")
        assert len(tokens) == 1


# -- projects ---------------------------------------------------------------

class TestProjects:
    async def test_register_and_list(self, store: ServerStore):
        await store.register_project("/home/user/proj1", "proj1")
        await store.register_project("/home/user/proj2", "proj2")
        projects = await store.list_projects()
        assert len(projects) == 2
        assert projects[0].name == "proj2"  # most recently opened first

    async def test_register_idempotent(self, store: ServerStore):
        await store.register_project("/home/user/proj", "proj")
        await store.register_project("/home/user/proj", "proj-renamed")
        projects = await store.list_projects()
        assert len(projects) == 1
        assert projects[0].name == "proj-renamed"  # name updated

    async def test_update_last_opened(self, store: ServerStore):
        await store.register_project("/home/user/proj", "proj")
        original = (await store.list_projects())[0].last_opened_at
        await store.update_project_last_opened("/home/user/proj")
        updated = (await store.list_projects())[0].last_opened_at
        assert updated >= original

    async def test_remove_project(self, store: ServerStore):
        await store.register_project("/home/user/proj", "proj")
        await store.remove_project("/home/user/proj")
        assert await store.list_projects() == []

    async def test_remove_project_cascades_recents(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.register_project("/home/user/proj", "proj")
        await store.add_recent_project("alice", "/home/user/proj")
        await store.remove_project("/home/user/proj")
        assert await store.get_recent_projects("alice") == []


# -- preferences ------------------------------------------------------------

class TestPreferences:
    async def test_get_empty(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        prefs = await store.get_preferences("alice")
        assert prefs == {}

    async def test_update_and_get(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        result = await store.update_preferences("alice", {"theme": "dark", "fontSize": 16})
        assert result == {"theme": "dark", "fontSize": 16}

        prefs = await store.get_preferences("alice")
        assert prefs["theme"] == "dark"

    async def test_merge_patch(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.update_preferences("alice", {"theme": "dark", "fontSize": 16})
        result = await store.update_preferences("alice", {"theme": "light"})
        assert result == {"theme": "light", "fontSize": 16}  # fontSize preserved


# -- recent projects --------------------------------------------------------

class TestRecentProjects:
    async def test_add_and_get(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.register_project("/home/user/proj1", "proj1")
        await store.register_project("/home/user/proj2", "proj2")
        await store.add_recent_project("alice", "/home/user/proj1")
        await store.add_recent_project("alice", "/home/user/proj2")

        recents = await store.get_recent_projects("alice")
        assert len(recents) == 2
        assert recents[0].project_path == "/home/user/proj2"  # most recent first

    async def test_upsert_updates_timestamp(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.register_project("/home/user/proj1", "proj1")
        await store.register_project("/home/user/proj2", "proj2")
        await store.add_recent_project("alice", "/home/user/proj1")
        await store.add_recent_project("alice", "/home/user/proj2")
        await store.add_recent_project("alice", "/home/user/proj1")  # re-open

        recents = await store.get_recent_projects("alice")
        assert recents[0].project_path == "/home/user/proj1"  # now most recent

    async def test_limit(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        for i in range(5):
            path = f"/home/user/proj{i}"
            await store.register_project(path, f"proj{i}")
            await store.add_recent_project("alice", path)

        recents = await store.get_recent_projects("alice", limit=3)
        assert len(recents) == 3

    async def test_per_user_isolation(self, store: ServerStore):
        await store.create_user("alice", "Alice")
        await store.create_user("bob", "Bob")
        await store.register_project("/home/user/proj", "proj")
        await store.add_recent_project("alice", "/home/user/proj")

        assert len(await store.get_recent_projects("alice")) == 1
        assert len(await store.get_recent_projects("bob")) == 0
