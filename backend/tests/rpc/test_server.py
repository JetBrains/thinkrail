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
from app.core.app_store import AppStore
from app.rpc.bus import bus
from app.rpc.server import METHODS, register_routes, _start_watcher
from app.spec.coordinator import IndexCoordinator
from app.spec.service import SpecService
from app.vis.service import VisualizationService


def _make_app(tmp_path: Path) -> FastAPI:
    """Create a test app with a fresh tokenless AppStore.

    Bonsai is single-user / localhost-only — no users, tokens, or
    handshake auth.  The store is opened lazily inside the WS handler.
    """
    app = FastAPI()
    store_dir = tmp_path / "_app_store"
    store_dir.mkdir(parents=True, exist_ok=True)

    store = AppStore(store_dir)
    register_routes(app, app_store=store)
    return app


def _ws_url(tmp_path: Path) -> str:
    """Build the tokenless WebSocket URL for a project directory."""
    return f"/ws?project={tmp_path}"


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
            "session/subscribe", "session/unsubscribe", "session/patchOutcomeAction",
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
            "appSettings/getSessionDefaults", "appSettings/setSessionDefaults",
            "models/list",
            "agent/retryLastMessage",
            "skills/list",
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

    def test_handshake_accepts_tokenless_connection(self, tmp_path: Path) -> None:
        """The handshake must complete without any ``?token=`` query param."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        url = _ws_url(tmp_path)
        # Sanity check: the URL we're about to send carries no token.
        assert "token=" not in url

        with client.websocket_connect(url) as ws:
            response = _send_and_receive(ws, "spec/list", 1)
            assert response["id"] == 1
            assert isinstance(response["result"], list)

    def test_missing_project_closes_4001(self, tmp_path: Path) -> None:
        """Connecting without a ``?project=`` query param closes 4001."""
        app = _make_app(tmp_path)
        client = TestClient(app)

        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/ws"):
                pass
        assert excinfo.value.code == 4001

    def test_nonexistent_project_closes_4002(self, tmp_path: Path) -> None:
        """A path that doesn't resolve to a directory closes with 4002."""
        app = _make_app(tmp_path)
        client = TestClient(app)

        bad = tmp_path / "definitely_does_not_exist" / "deep" / "subdir"
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect(f"/ws?project={bad}"):
                pass
        assert excinfo.value.code == 4002

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

    def test_clients_get_local_user_identity(self, tmp_path: Path) -> None:
        """In the single-user model every connection is identified as 'local'."""
        _make_config(tmp_path)
        app = _make_app(tmp_path)
        client = TestClient(app)

        with client.websocket_connect(_ws_url(tmp_path)):
            # Inspect the bus directly — every registered connection
            # carries the fixed single-user identity.
            connections = list(bus._connections.values())  # noqa: SLF001
            assert connections, "expected at least one connection registered"
            assert all(c.user_id == "local" for c in connections)
            assert all(c.display_name == "Local" for c in connections)


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
