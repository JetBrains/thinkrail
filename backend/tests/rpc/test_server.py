from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from watchfiles import Change

from app.core.config import AppConfig, load_config
from app.rpc.bus import bus
from app.rpc.server import METHODS, register_routes, _start_watcher
from app.spec.service import SpecService
from app.vis.service import VisualizationService


def _make_app() -> FastAPI:
    app = FastAPI()
    register_routes(app)
    return app


def _make_config(tmp_path: Path) -> AppConfig:
    bonsai_dir = tmp_path / ".bonsai"
    bonsai_dir.mkdir()
    registry = {"version": "2.0", "project": "test", "specs": [], "links": []}
    (bonsai_dir / "registry.json").write_text(json.dumps(registry), encoding="utf-8")
    return load_config(tmp_path)


class TestMethods:
    def test_methods_dict_has_all_methods(self) -> None:
        expected = {
            "spec/list", "spec/get", "spec/create",
            "spec/update", "spec/delete", "spec/graph",
            "agent/run", "agent/prepare", "agent/updateDraft", "agent/startDraft",
            "agent/send", "agent/status", "agent/list",
            "agent/interrupt", "agent/end", "agent/respond", "agent/updateConfig",
            "agent/transcribe",
            "session/list", "session/get", "session/continue", "session/restart", "session/delete", "session/restore",
            "session/subscribe", "session/unsubscribe",
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
            "models/list", "models/refresh",
            "skills/list",
            "auth/createToken", "auth/listUsers",
            "connection/list",
        }
        assert set(METHODS.keys()) == expected


class TestWebSocket:
    def test_connect_and_receive_response(self, tmp_path: Path) -> None:
        _make_config(tmp_path)  # ensure .bonsai exists
        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws:
            request = {
                "jsonrpc": "2.0",
                "method": "spec/list",
                "params": {},
                "id": 1,
            }
            ws.send_text(json.dumps(request))
            response = json.loads(ws.receive_text())
            assert response["jsonrpc"] == "2.0"
            assert response["id"] == 1
            assert isinstance(response["result"], list)

    def test_connection_registers_with_bus(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        initial_count = bus.connection_count
        with client.websocket_connect(f"/ws?project={tmp_path}"):
            assert bus.connection_count > initial_count
        # Connection should be unregistered on disconnect
        assert bus.connection_count == initial_count

    def test_missing_project_param_closes(self) -> None:
        app = _make_app()
        client = TestClient(app)

        with pytest.raises(Exception):
            with client.websocket_connect("/ws"):
                pass

    def test_method_not_found_returns_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws:
            request = {
                "jsonrpc": "2.0",
                "method": "nonexistent/method",
                "params": {},
                "id": 1,
            }
            ws.send_text(json.dumps(request))
            response = json.loads(ws.receive_text())
            assert "error" in response
            assert response["error"]["code"] == -32601

    def test_invalid_json_returns_parse_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws:
            ws.send_text("not valid json{{{")
            response = json.loads(ws.receive_text())
            assert "error" in response
            assert response["error"]["code"] == -32700

    def test_spec_get_not_found_returns_domain_error(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws:
            request = {
                "jsonrpc": "2.0",
                "method": "spec/get",
                "params": {"id": "nonexistent"},
                "id": 1,
            }
            ws.send_text(json.dumps(request))
            response = json.loads(ws.receive_text())
            assert "error" in response
            assert response["error"]["code"] == -32001

    def test_notification_no_response(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws:
            notification = {
                "jsonrpc": "2.0",
                "method": "spec/list",
                "params": {},
            }
            ws.send_text(json.dumps(notification))

            request = {
                "jsonrpc": "2.0",
                "method": "spec/list",
                "params": {},
                "id": 99,
            }
            ws.send_text(json.dumps(request))
            response = json.loads(ws.receive_text())
            assert response["id"] == 99


class TestMultiClientIntegration:
    """Integration tests for multi-client WebSocket scenarios."""

    def test_two_clients_both_register(self, tmp_path: Path) -> None:
        """Two WebSocket clients to the same project both register with the bus."""
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        initial_count = bus.connection_count
        with client.websocket_connect(f"/ws?project={tmp_path}"):
            count_after_first = bus.connection_count
            assert count_after_first >= initial_count + 1
            with client.websocket_connect(f"/ws?project={tmp_path}"):
                assert bus.connection_count >= count_after_first + 1

    def test_two_clients_both_can_call_rpc(self, tmp_path: Path) -> None:
        """Both connected clients can independently make RPC calls."""
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        def _call_and_get_response(ws, method: str, rpc_id: int) -> dict:
            """Send RPC call and skip notifications until we get the response."""
            ws.send_text(json.dumps({"jsonrpc": "2.0", "method": method, "params": {}, "id": rpc_id}))
            while True:
                msg = json.loads(ws.receive_text())
                if "id" in msg and msg["id"] == rpc_id:
                    return msg

        with client.websocket_connect(f"/ws?project={tmp_path}") as ws1:
            with client.websocket_connect(f"/ws?project={tmp_path}") as ws2:
                resp2 = _call_and_get_response(ws2, "spec/list", 2)
                assert isinstance(resp2["result"], list)

                resp1 = _call_and_get_response(ws1, "spec/list", 1)
                assert isinstance(resp1["result"], list)


class TestAuthIntegration:
    """Integration tests for WebSocket authentication."""

    def test_valid_token_connects(self, tmp_path: Path) -> None:
        """Valid token allows WebSocket connection."""
        _make_config(tmp_path)
        from app.rpc.auth import save_user
        token = save_user(tmp_path, "alice", "Alice")

        app = _make_app()
        client = TestClient(app)
        with client.websocket_connect(f"/ws?project={tmp_path}&token={token}") as ws:
            ws.send_text(json.dumps({"jsonrpc": "2.0", "method": "spec/list", "params": {}, "id": 1}))
            resp = json.loads(ws.receive_text())
            assert resp["id"] == 1

    def test_invalid_token_rejected(self, tmp_path: Path) -> None:
        """Invalid token with allowAnonymous=False closes the WebSocket."""
        _make_config(tmp_path)
        users_data = {
            "users": [{"id": "alice", "name": "Alice", "token": "bns_valid"}],
            "allowAnonymous": False,
        }
        (tmp_path / ".bonsai" / "users.json").write_text(json.dumps(users_data))

        app = _make_app()
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws?project={tmp_path}&token=bns_wrong"):
                pass

    def test_no_token_anonymous_disallowed_rejected(self, tmp_path: Path) -> None:
        """No token with allowAnonymous=False closes the WebSocket."""
        _make_config(tmp_path)
        users_data = {"users": [], "allowAnonymous": False}
        (tmp_path / ".bonsai" / "users.json").write_text(json.dumps(users_data))

        app = _make_app()
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect(f"/ws?project={tmp_path}"):
                pass


class TestWatcher:
    async def test_start_watcher(self, tmp_path: Path) -> None:
        import asyncio
        config = _make_config(tmp_path)
        service = SpecService(config)
        vis_service = VisualizationService(config)
        handle = await _start_watcher(str(tmp_path), config, service, vis_service)
        assert handle is not None
        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass


class TestOnFileChange:
    """Test the _on_file_change callback by capturing it from _start_watcher."""

    @pytest.fixture
    def config(self, tmp_path: Path) -> AppConfig:
        bonsai_dir = tmp_path / ".bonsai"
        bonsai_dir.mkdir()
        registry = {
            "version": "2.0", "project": "test",
            "specs": [
                {
                    "id": "mod-a", "type": "module-design",
                    "path": "mod_a/README.md", "title": "Module A",
                    "status": "active", "covers": [], "tags": [],
                    "created": "2026-01-01", "updated": "2026-01-01",
                }
            ],
            "links": [],
        }
        (bonsai_dir / "registry.json").write_text(json.dumps(registry), encoding="utf-8")
        (tmp_path / "mod_a").mkdir()
        (tmp_path / "mod_a" / "README.md").write_text("# Module A", encoding="utf-8")
        return load_config(tmp_path)

    @pytest.fixture
    async def callback(self, config: AppConfig):
        """Start watcher, capture callback, then stop."""
        import asyncio
        from app.rpc.server import _start_watcher
        captured = {}

        async def fake_watch(paths, cb):
            captured["cb"] = cb
            from app.core.watcher import WatchHandle
            return WatchHandle(_task=asyncio.create_task(asyncio.sleep(999)))

        service = SpecService(config)
        vis_service = VisualizationService(config)
        project_key = str(config.get_project_root())
        with patch("app.rpc.server.watch", side_effect=fake_watch):
            handle = await _start_watcher(project_key, config, service, vis_service)
        yield captured["cb"]
        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass

    async def test_registry_change_sends_content(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            registry_path = str(config.get_registry_path())
            await callback({(Change.modified, registry_path)})

            methods = [c.kwargs.get("method") or c.args[1] for c in mock_pub.call_args_list]
            assert "registry/didUpdate" in methods
            reg_call = next(c for c in mock_pub.call_args_list if (c.kwargs.get("method") or c.args[1]) == "registry/didUpdate")
            params = reg_call.kwargs.get("params") or reg_call.args[2]
            assert "registry" in params
            assert params["registry"]["version"] == "2.0"
            assert "file/didChange" in methods

    async def test_spec_modified_sends_did_change(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.modified, spec_path)})

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

            calls = mock_pub.call_args_list
            first = calls[0]
            method = first.kwargs.get("method") or first.args[1]
            params = first.kwargs.get("params") or first.args[2]
            assert method == "spec/didCreate"
            assert params["id"] == "mod-a"
            assert params["path"] == "mod_a/README.md"

    async def test_spec_deleted_sends_did_delete(
        self, config: AppConfig, callback
    ) -> None:
        with patch.object(bus, "publish", new_callable=AsyncMock) as mock_pub:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.deleted, spec_path)})

            calls = mock_pub.call_args_list
            first = calls[0]
            method = first.kwargs.get("method") or first.args[1]
            params = first.kwargs.get("params") or first.args[2]
            assert method == "spec/didDelete"
            assert params["id"] == "mod-a"

    async def test_no_subscribers_does_not_crash(
        self, config: AppConfig, callback
    ) -> None:
        """Publishing with no subscribers should succeed silently."""
        spec_path = str(config.get_project_root() / "mod_a" / "README.md")
        # No mock, no subscribers — should not raise
        await callback({(Change.modified, spec_path)})

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
