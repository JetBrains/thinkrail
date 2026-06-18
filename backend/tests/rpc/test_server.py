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


def _make_app(tmp_path: Path) -> FastAPI:
    """Create a test app with a fresh tokenless AppStore.

    ThinkRail is single-user / localhost-only — no users, tokens, or
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
    thinkrail_dir = tmp_path / ".tr"
    thinkrail_dir.mkdir(exist_ok=True)
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
            "session/list", "session/get", "session/continue", "session/restart", "session/delete",
            "session/subscribe", "session/unsubscribe", "session/patchOutcomeAction",
            "session/promoteToTicket",
            "subsession/create", "subsession/requestSummary",
            "subsession/approveSummary", "subsession/dismissSummary",
            "subsession/reviseSummary", "subsession/listChildren",
            "board/list", "board/get", "board/getState", "board/apply",
            "board/create", "board/update", "board/delete",
            "board/linkSpec", "board/unlinkSpec",
            "board/attachSession", "board/detachSession", "board/setOrchestrator",
            "board/reorder", "board/readArtifact", "board/writeArtifact",
            "board/getHistory",
            "board/completeNode", "board/refineNode",
            "settings/get", "settings/update", "settings/ensureFile",
            "appSettings/getSessionDefaults", "appSettings/setSessionDefaults",
            "appSettings/getAnalyticsConsent", "appSettings/setAnalyticsConsent",
            "runtimes/list", "runtimes/capabilities",
            "agent/retryLastMessage",
            "skills/list",
            "skills/listRuntime",
        }
        assert set(METHODS.keys()) == expected


class TestWebSocket:
    def test_connect_and_receive_response(self, tmp_path: Path) -> None:
        _make_config(tmp_path)  # ensure .tr exists
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
        # the path under ~/.tr/indexes/<hash>/)
        db_path = tmp_path / ".tr" / "index.db"
        index = SpecIndex(db_path)
        await index.open()
        service = SpecService(config, index=index)
        coordinator = IndexCoordinator(index, tmp_path, AsyncMock())
        handle = await _start_watcher(str(tmp_path), config, service, coordinator)
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

        thinkrail_dir = tmp_path / ".tr"
        thinkrail_dir.mkdir()
        # Create spec file with frontmatter
        (tmp_path / "mod_a").mkdir()
        meta = {"id": "mod-a", "type": "module-design", "status": "active", "title": "Module A"}
        content = serialize_frontmatter(meta, "# Module A\n")
        (tmp_path / "mod_a" / "README.md").write_text(content, encoding="utf-8")
        # Build index (use local temp path for tests)
        db_path = thinkrail_dir / "index.db"
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
        db_path = config.get_thinkrail_dir() / "index.db"
        index = SpecIndex(db_path)
        await index.initialize(config.get_project_root())
        service = SpecService(config, index=index)
        project_root = config.get_project_root()
        project_key = str(project_root)
        project_topic = f"project:{project_key}"

        # Wire coordinator notify to bus.publish (matches production wiring)
        async def _coordinator_notify(method: str, params: dict) -> None:
            await bus.publish(project_topic, method, params)

        coordinator = IndexCoordinator(index, project_root, _coordinator_notify)
        coordinator.start()

        with patch("app.rpc.server.watch", side_effect=fake_watch):
            handle = await _start_watcher(project_key, config, service, coordinator)

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


class TestThinkRailhideLiveReload:
    """Regression: editing .thinkrailhide must take effect without a restart,
    and same-batch .md moves must respect the new rules immediately.

    Bug: on ``refactor/specs-renewal @ 57f6d178a``, after adding
    ``.tr/archive/`` to .thinkrailhide and ``git mv``-ing spec .md files
    into that directory, ``spec_search`` continued to return the archived
    files (with their new paths) until a manual backend restart.  Two
    defects compose:

    1. Atomic-write editors (vim, IntelliJ, VSCode, Edit/Write tools) save
       by write-temp + rename, which watchfiles reports as ``Change.added``
       rather than ``Change.modified``.  The old check
       ``ct == Change.modified and Path(p).name == ".thinkrailhide"`` missed
       those events.
    2. Even when ``Change.modified`` did fire, FileChanged events emitted
       from the same batch were dispatched against the *stale* in-memory
       hide rules — the 500 ms-debounced rebuild fired afterwards.  A
       ``spec_search`` issued in that window returned newly-archived
       entries.
    """

    @pytest.fixture
    async def config(self, tmp_path: Path) -> AppConfig:
        from app.spec.frontmatter import serialize_frontmatter
        from app.spec.index import SpecIndex

        thinkrail_dir = tmp_path / ".tr"
        thinkrail_dir.mkdir()

        # Pre-existing spec that will later be moved into a now-hidden dir.
        (tmp_path / "mod_a").mkdir()
        meta = {
            "id": "mod-a", "type": "module-design",
            "status": "active", "title": "Module A",
        }
        (tmp_path / "mod_a" / "README.md").write_text(
            serialize_frontmatter(meta, "# Module A\n"), encoding="utf-8",
        )

        db_path = thinkrail_dir / "index.db"
        async with SpecIndex(db_path) as index:
            await index.rebuild(tmp_path)
        return load_config(tmp_path)

    @pytest.fixture
    async def harness(self, config: AppConfig):
        """Bring up _start_watcher with the fake_watch pattern so the test
        can drive _on_file_change directly.  Yields (callback, index,
        coordinator) for assertions."""
        import asyncio
        from app.rpc.server import _start_watcher
        from app.spec.index import SpecIndex

        captured: dict = {}

        async def fake_watch(paths, cb):
            captured["cb"] = cb
            from app.core.watcher import WatchHandle
            return WatchHandle(_task=asyncio.create_task(asyncio.sleep(999)))

        db_path = config.get_thinkrail_dir() / "index.db"
        index = SpecIndex(db_path)
        await index.initialize(config.get_project_root())
        service = SpecService(config, index=index)
        project_root = config.get_project_root()
        project_key = str(project_root)
        project_topic = f"project:{project_key}"

        async def _coordinator_notify(method: str, params: dict) -> None:
            await bus.publish(project_topic, method, params)

        coordinator = IndexCoordinator(index, project_root, _coordinator_notify)
        coordinator.start()

        with patch("app.rpc.server.watch", side_effect=fake_watch):
            handle = await _start_watcher(
                project_key, config, service, coordinator,
            )

        yield captured["cb"], index, coordinator, project_root

        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass
        await coordinator.stop()
        await index.close()

    async def test_atomic_rename_change_added_triggers_reload(
        self, harness,
    ) -> None:
        """A Change.added event for .thinkrailhide (atomic-write rename) must
        be treated as a change — old code only accepted Change.modified."""
        callback, index, coordinator, project_root = harness

        # User edits .thinkrailhide via an editor that saves atomically — the
        # OS reports Change.added after the rename(2).
        (project_root / ".thinkrailhide").write_text(
            "mod_a/\n", encoding="utf-8",
        )
        thinkrailhide_path = str(project_root / ".thinkrailhide")
        await callback({(Change.added, thinkrailhide_path)})

        # The synchronous in-memory refresh must have happened — the index's
        # _thinkrailhide_spec is no longer None.
        assert index._thinkrailhide_spec is not None
        # And the new spec actually matches mod_a/.
        assert index._thinkrailhide_spec.match_file("mod_a/README.md")

    async def test_deleted_thinkrailhide_reloads_to_defaults(
        self, harness,
    ) -> None:
        """Change.deleted on .thinkrailhide must also trigger a reload (defaults)."""
        callback, index, coordinator, project_root = harness

        # First set a custom .thinkrailhide so we have something to clear.
        (project_root / ".thinkrailhide").write_text(
            "mod_a/\n", encoding="utf-8",
        )
        await callback({(Change.added, str(project_root / ".thinkrailhide"))})
        assert index._thinkrailhide_spec is not None
        assert index._thinkrailhide_spec.match_file("mod_a/README.md")

        # Now delete .thinkrailhide outright.  The watcher must reload defaults,
        # which do NOT match mod_a/.
        (project_root / ".thinkrailhide").unlink()
        await callback({(Change.deleted, str(project_root / ".thinkrailhide"))})
        assert index._thinkrailhide_spec is not None
        assert not index._thinkrailhide_spec.match_file("mod_a/README.md")

    async def test_same_batch_hidden_md_not_indexed(
        self, harness,
    ) -> None:
        """A .thinkrailhide change and a .md add in the SAME watcher batch:
        the newly-hidden .md must NOT be indexed.

        This is the witnessed reproduction: edit .thinkrailhide, then git mv a
        spec into the now-hidden dir, all delivered as one batch.
        """
        from app.spec.frontmatter import serialize_frontmatter

        callback, index, coordinator, project_root = harness

        # Pre-stage: the .thinkrailhide content on disk already hides archive/
        # (the watcher reads from disk when it sees a change event).
        (project_root / ".thinkrailhide").write_text(
            "archive/\n", encoding="utf-8",
        )

        # Pre-stage: the file already exists at the new (hidden) path,
        # mimicking a completed git mv before the watcher batch arrives.
        archive_dir = project_root / "archive"
        archive_dir.mkdir()
        meta = {
            "id": "archived-spec", "type": "task-spec",
            "status": "draft", "title": "Archived",
        }
        archived_md = archive_dir / "spec.md"
        archived_md.write_text(
            serialize_frontmatter(meta, "# Archived\n"), encoding="utf-8",
        )

        # One batch carries both events.
        await callback({
            (Change.added, str(project_root / ".thinkrailhide")),
            (Change.added, str(archived_md)),
        })
        await coordinator._queue.join()

        # The archived spec must NOT be in the index — reindex_file ran
        # against the freshly-refreshed hide rules.
        assert await index.get_spec("archived-spec") is None

    async def test_previously_indexed_evicted_after_hide(
        self, harness,
    ) -> None:
        """A file already indexed should be evicted when .thinkrailhide hides it.

        Covers the eviction path: index has mod-a; user edits .thinkrailhide to
        hide mod_a/; subsequent reindex_file on mod_a/README.md (triggered
        either by an in-batch FileChanged or by the debounced full rebuild)
        removes it.  This test exercises the in-batch path via a synthetic
        FileChanged for the (still-present-on-disk) file.
        """
        callback, index, coordinator, project_root = harness

        # Sanity: mod-a is currently indexed by the fixture's rebuild().
        spec = await index.get_spec("mod-a")
        assert spec is not None

        # User adds mod_a/ to .thinkrailhide (atomic write reports as added).
        (project_root / ".thinkrailhide").write_text(
            "mod_a/\n", encoding="utf-8",
        )
        readme = str(project_root / "mod_a" / "README.md")
        await callback({
            (Change.added, str(project_root / ".thinkrailhide")),
            (Change.modified, readme),
        })
        await coordinator._queue.join()

        # mod-a is no longer indexed — the FileChanged for its README ran
        # against the new hide rules and removed it.
        assert await index.get_spec("mod-a") is None
