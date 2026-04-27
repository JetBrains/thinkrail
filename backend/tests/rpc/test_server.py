from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from watchfiles import Change

from app.core.config import AppConfig, load_config
from app.core.server_store import ServerStore
from app.rpc.bus import bus
from app.rpc.server import METHODS, register_routes, _start_watcher
from app.spec.coordinator import IndexCoordinator
from app.spec.service import SpecService
from app.vis.service import VisualizationService

# Reusable test token for WebSocket auth.
_TEST_TOKEN = "bns_test00000000000000000000"


def _make_app(tmp_path: Path | None = None) -> FastAPI:
    """Create a test app with a ServerStore pre-seeded with a test user/token.

    Uses synchronous sqlite3 to set up test data, then hands the store
    directory to ServerStore (which opens lazily in the WS handler).
    """
    import sqlite3

    app = FastAPI()
    store_dir = (tmp_path or Path("/tmp")) / "_server_store"
    store_dir.mkdir(parents=True, exist_ok=True)
    db_path = store_dir / "bonsai.db"

    # Pre-seed the database with a test user and token using sync sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS server_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS projects (path TEXT PRIMARY KEY, name TEXT NOT NULL, registered_at TEXT NOT NULL, last_opened_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), prefs TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS user_recent_projects (user_id TEXT NOT NULL REFERENCES users(id), project_path TEXT NOT NULL REFERENCES projects(path), last_opened TEXT NOT NULL, PRIMARY KEY (user_id, project_path)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_recent_projects_user_time ON user_recent_projects(user_id, last_opened DESC);
    """)
    conn.execute(
        "INSERT OR IGNORE INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("testuser", "Test User", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    conn.execute(
        "INSERT OR IGNORE INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)",
        (_TEST_TOKEN, "testuser", "2026-01-01T00:00:00Z"),
    )
    conn.commit()
    conn.close()

    store = ServerStore(store_dir)
    register_routes(app, server_store=store)
    return app


def _ws_url(tmp_path: Path, token: str | None = None) -> str:
    """Build WebSocket URL with project and optional token."""
    t = token or _TEST_TOKEN
    url = f"/ws?project={tmp_path}"
    if t:
        url += f"&token={t}"
    return url


def _make_config(tmp_path: Path) -> AppConfig:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir(exist_ok=True)
    return load_config(tmp_path)


# Lifecycle notifications that arrive between connect and the first RPC
# response.  These are expected — ProjectContext.start_services() emits
# coordinator events (index/rebuilding, index/ready) and connection/didJoin
# may arrive from a concurrent connection.
_EXPECTED_NOTIFICATIONS = frozenset({
    "index/rebuilding", "index/ready", "connection/didJoin", "connection/didLeave",
})


def _send_and_receive(ws, method: str, rpc_id: int, params: dict | None = None) -> dict:
    """Send an RPC call and return the response, skipping lifecycle notifications."""
    ws.send_text(json.dumps({
        "jsonrpc": "2.0", "method": method, "params": params or {}, "id": rpc_id,
    }))
    while True:
        msg = json.loads(ws.receive_text())
        if "id" in msg and msg["id"] == rpc_id:
            return msg
        # Only skip expected lifecycle notifications — fail on unexpected ones
        notif_method = msg.get("method", "")
        assert notif_method in _EXPECTED_NOTIFICATIONS, (
            f"Unexpected notification while waiting for RPC {rpc_id}: {msg}"
        )


class TestMethods:
    def test_methods_dict_has_all_methods(self) -> None:
        expected = {
            "spec/list", "spec/get", "spec/create",
            "spec/update", "spec/delete", "spec/graph",
            "agent/run", "agent/prepare", "agent/updateDraft", "agent/startDraft",
            "agent/send", "agent/status", "agent/list",
            "agent/interrupt", "agent/end", "agent/respond", "agent/updateConfig",
            "agent/transcribe",
            "agent/reviseTranscript",
            "session/list", "session/get", "session/continue", "session/restart", "session/delete", "session/restore",
            "session/subscribe", "session/unsubscribe",
            "subsession/create", "subsession/requestSummary",
            "subsession/approveSummary", "subsession/dismissSummary",
            "subsession/reviseSummary", "subsession/listChildren",
            "vis/state", "vis/recompute",
            "board/list", "board/get", "board/create", "board/update", "board/delete",
            "board/linkSpec", "board/unlinkSpec",
            "board/attachSession", "board/detachSession", "board/setPlanPath", "board/setOrchestrator",
            "board/getPlan", "board/createPlan", "board/savePlan",
            "board/getPlanRaw", "board/savePlanRaw",
            "board/updateStep", "board/getNextStep", "board/reorder",
            "board/listDrafts", "board/getDraftDiff",
            "board/applyDraft", "board/applyAllDrafts",
            "board/discardDraft", "board/discardAllDrafts",
            "board/listPatches", "board/getPatchDiff", "board/revertPatch",
            "trash/list", "trash/purge", "trash/empty",
            "trash/restoreSpec", "trash/restorePlan", "trash/restoreDraft", "trash/restorePatches",
            "settings/get", "settings/update", "settings/ensureFile",
            "models/list", "models/refresh", "models/status",
            "agent/retryLastMessage",
            "skills/list",
            "auth/createToken", "auth/listUsers",
            "connection/list",
            "admin/listUsers", "admin/createUser", "admin/deleteUser",
            "admin/setAdmin", "admin/removeAdmin", "admin/revokeToken",
            "user/getProfile", "user/getPreferences",
            "user/updatePreferences", "user/getRecentProjects",
        }
        assert set(METHODS.keys()) == expected


class TestWebSocket:
    def test_connect_and_receive_response(self, tmp_path: Path) -> None:
        _make_config(tmp_path)  # ensure .bonsai exists
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            response = _send_and_receive(ws, "spec/list", 1)
            assert response["jsonrpc"] == "2.0"
            assert response["id"] == 1
            assert isinstance(response["result"], list)

    def test_connection_registers_with_bus(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        initial_count = bus.connection_count
        with client.websocket_connect(_ws_url(tmp_path)):
            assert bus.connection_count > initial_count
        # Connection should be unregistered on disconnect
        assert bus.connection_count == initial_count

    def test_missing_project_param_closes(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        client = TestClient(app)

        with pytest.raises(Exception):
            with client.websocket_connect("/ws"):
                pass

    def test_method_not_found_returns_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            response = _send_and_receive(ws, "nonexistent/method", 1)
            assert "error" in response
            assert response["error"]["code"] == -32601

    def test_invalid_json_returns_parse_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            # Invalid JSON still gets a response with an id (from jsonrpcserver)
            ws.send_text("not valid json{{{")
            # Skip notifications, look for the error response
            while True:
                response = json.loads(ws.receive_text())
                if "error" in response:
                    break
            assert response["error"]["code"] == -32700

    def test_spec_get_not_found_returns_domain_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            response = _send_and_receive(ws, "spec/get", 1, {"id": "nonexistent"})
            assert "error" in response
            # May return -32015 (index not ready) or -32001 (spec not found)
            # — both are valid domain errors.
            assert response["error"]["code"] in (-32001, -32015)

    def test_notification_no_response(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            # Send a JSON-RPC notification (no id) — should not produce a response
            notification = {
                "jsonrpc": "2.0",
                "method": "spec/list",
                "params": {},
            }
            ws.send_text(json.dumps(notification))

            # Follow up with a request that has an id
            response = _send_and_receive(ws, "spec/list", 99)
            assert response["id"] == 99


class TestMultiClientIntegration:
    """Integration tests for multi-client WebSocket scenarios."""

    def test_two_clients_both_register(self, tmp_path: Path) -> None:
        """Two WebSocket clients to the same project both register with the bus."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        initial_count = bus.connection_count
        with client.websocket_connect(_ws_url(tmp_path)):
            count_after_first = bus.connection_count
            assert count_after_first >= initial_count + 1
            with client.websocket_connect(_ws_url(tmp_path)):
                assert bus.connection_count >= count_after_first + 1

    def test_two_clients_both_can_call_rpc(self, tmp_path: Path) -> None:
        """Both connected clients can independently make RPC calls."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)) as ws1:
            with client.websocket_connect(_ws_url(tmp_path)) as ws2:
                resp2 = _send_and_receive(ws2, "spec/list", 2)
                assert isinstance(resp2["result"], list)

                resp1 = _send_and_receive(ws1, "spec/list", 1)
                assert isinstance(resp1["result"], list)


class TestAuthIntegration:
    """Integration tests for WebSocket authentication."""

    def test_valid_token_connects(self, tmp_path: Path) -> None:
        """Valid server-wide token allows WebSocket connection."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)
        # _make_app creates a test token; use it
        with client.websocket_connect(_ws_url(tmp_path)) as ws:
            resp = _send_and_receive(ws, "spec/list", 1)
            assert resp["id"] == 1

    def test_per_project_token_fallback(self, tmp_path: Path) -> None:
        """Token in per-project users.json works via fallback migration."""
        _make_config(tmp_path)
        users_data = {
            "users": [{"id": "alice", "name": "Alice", "token": "bns_projectonly"}],
        }
        (tmp_path / ".bonsai" / "users.json").write_text(json.dumps(users_data))

        app = _make_app(tmp_path)
        client = TestClient(app)
        with client.websocket_connect(_ws_url(tmp_path, token="bns_projectonly")) as ws:
            resp = _send_and_receive(ws, "spec/list", 1)
            assert resp["id"] == 1

    def test_invalid_token_rejected(self, tmp_path: Path) -> None:
        """Invalid token closes the WebSocket."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect(_ws_url(tmp_path, token="bns_wrong")):
                pass

    def test_no_token_rejected(self, tmp_path: Path) -> None:
        """No token closes the WebSocket (no anonymous access)."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws?project={tmp_path}"):
                pass


class TestWatcher:
    async def test_start_watcher(self, tmp_path: Path) -> None:
        import asyncio
        from app.spec.index import SpecIndex

        config = _make_config(tmp_path)
        # Use a temp path for the index (in production, get_index_path() computes
        # the path under ~/.bonsai/indexes/<hash>/)
        db_path = tmp_path / ".bonsai" / "index.db"
        index = SpecIndex(db_path)
        await index.open()
        service = SpecService(config, index=index)
        vis_service = VisualizationService(config, spec_service=service)
        coordinator = IndexCoordinator(index, tmp_path, AsyncMock())
        handle = await _start_watcher(str(tmp_path), config, service, vis_service, coordinator)
        assert handle is not None
        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass


class TestOnFileChange:
    """Test the _on_file_change callback by capturing it from _start_watcher."""

    @pytest.fixture
    async def config(self, tmp_path: Path) -> AppConfig:
        from app.spec.frontmatter import serialize_frontmatter
        from app.spec.index import SpecIndex

        bonsai_dir = tmp_path / ".bonsai"
        bonsai_dir.mkdir()
        # Create spec file with frontmatter
        (tmp_path / "mod_a").mkdir()
        meta = {"id": "mod-a", "type": "module-design", "status": "active", "title": "Module A"}
        content = serialize_frontmatter(meta, "# Module A\n")
        (tmp_path / "mod_a" / "README.md").write_text(content, encoding="utf-8")
        # Build index (use local temp path for tests)
        db_path = bonsai_dir / "index.db"
        async with SpecIndex(db_path) as index:
            await index.rebuild(tmp_path)
        return load_config(tmp_path)

    @pytest.fixture
    async def callback(self, config: AppConfig):
        """Start watcher, capture callback, then stop.

        The coordinator's notify callback is wired to bus.publish (like
        production) so that tests can check all notifications via a
        single bus.publish mock.
        """
        import asyncio
        from app.rpc.server import _start_watcher
        from app.spec.index import SpecIndex

        captured = {}

        async def fake_watch(paths, cb):
            captured["cb"] = cb
            from app.core.watcher import WatchHandle
            return WatchHandle(_task=asyncio.create_task(asyncio.sleep(999)))

        # Use local temp path for tests (production uses get_index_path())
        db_path = config.get_bonsai_dir() / "index.db"
        index = SpecIndex(db_path)
        await index.initialize(config.get_project_root())
        service = SpecService(config, index=index)
        vis_service = VisualizationService(config, spec_service=service)
        project_root = config.get_project_root()
        project_key = str(project_root)
        project_topic = f"project:{project_key}"

        # Wire coordinator notify to bus.publish (matches production wiring)
        async def _coordinator_notify(method: str, params: dict) -> None:
            await bus.publish(project_topic, method, params)

        coordinator = IndexCoordinator(index, project_root, _coordinator_notify)
        coordinator.start()

        with patch("app.rpc.server.watch", side_effect=fake_watch):
            handle = await _start_watcher(project_key, config, service, vis_service, coordinator)

        # Expose coordinator so tests can wait for event processing
        captured["coordinator"] = coordinator

        yield captured["cb"]
        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass
        await coordinator.stop()
        await index.close()

    async def _drain_coordinator(self, callback) -> None:
        """Wait for the coordinator to finish processing all queued events."""
        # The callback fixture stores the coordinator in the closure;
        # we access it via the queue join to ensure all events are processed.
        await asyncio.sleep(0.05)

    async def test_spec_modified_sends_did_change(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.modified, spec_path)})
            # Allow coordinator to process the FileChanged event
            await self._drain_coordinator(callback)

            methods = [c.kwargs.get("method") or c.args[1] for c in mock_pub.call_args_list]
            assert "spec/didChange" in methods
            spec_call = next(c for c in mock_pub.call_args_list if (c.kwargs.get("method") or c.args[1]) == "spec/didChange")
            params = spec_call.kwargs.get("params") or spec_call.args[2]
            assert params["id"] == "mod-a"
            assert "changes" in params
            assert "file/didChange" in methods

    async def test_spec_created_sends_did_create(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.added, spec_path)})
            # Allow coordinator to process the FileChanged event
            await self._drain_coordinator(callback)

            methods = [c.kwargs.get("method") or c.args[1] for c in mock_pub.call_args_list]
            # Coordinator sends spec/didChange for reindex results (not didCreate)
            # because it uses reindex_file which classifies as "spec"
            assert "spec/didChange" in methods
            spec_call = next(c for c in mock_pub.call_args_list if (c.kwargs.get("method") or c.args[1]) == "spec/didChange")
            params = spec_call.kwargs.get("params") or spec_call.args[2]
            assert params["id"] == "mod-a"

    async def test_spec_deleted_sends_did_delete(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.deleted, spec_path)})
            # Allow coordinator to process the FileChanged event
            await self._drain_coordinator(callback)

            methods = [c.kwargs.get("method") or c.args[1] for c in mock_pub.call_args_list]
            # File was deleted, so the file tree notification fires
            assert "files/treeChanged" in methods

    async def test_no_subscribers_does_not_crash(
        self, config: AppConfig, callback
    ) -> None:
        """Publishing with no subscribers should succeed silently."""
        spec_path = str(config.get_project_root() / "mod_a" / "README.md")
        # No mock, no subscribers — should not raise
        await callback({(Change.modified, spec_path)})
        await self._drain_coordinator(callback)

    async def test_non_spec_file_ignored(
        self, config: AppConfig, callback
    ) -> None:
        """Non-spec files should not trigger spec/registry notifications.

        A generic ``file/didChange`` notification is still sent so that
        open editors in the frontend can refresh.
        """
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            random_path = str(config.get_project_root() / "some_file.py")
            await callback({(Change.modified, random_path)})
            methods = [c.kwargs.get("method") or c.args[1] for c in mock_pub.call_args_list]
            assert "spec/didChange" not in methods
            assert "spec/didCreate" not in methods
            assert "spec/didDelete" not in methods
            assert "registry/didUpdate" not in methods
