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
from app.rpc import notifications
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
            "vis/state", "vis/recompute",
            "board/list", "board/get", "board/create", "board/update", "board/delete",
            "board/linkSpec", "board/unlinkSpec",
            "board/attachSession", "board/setPlanPath", "board/setOrchestrator",
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

    def test_notification_sets_current_notify(self, tmp_path: Path) -> None:
        _make_config(tmp_path)
        app = _make_app()
        client = TestClient(app)

        assert notifications.current_notify is None
        with client.websocket_connect(f"/ws?project={tmp_path}"):
            assert notifications.current_notify is not None
        assert notifications.current_notify is None

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


class TestWatcher:
    async def test_start_watcher(self, tmp_path: Path) -> None:
        import asyncio
        config = _make_config(tmp_path)
        service = SpecService(config)
        vis_service = VisualizationService(config)
        handle = await _start_watcher(config, service, vis_service)
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
        captured = {}

        async def fake_watch(paths, cb):
            captured["cb"] = cb
            from app.core.watcher import WatchHandle
            return WatchHandle(_task=asyncio.create_task(asyncio.sleep(999)))

        service = SpecService(config)
        vis_service = VisualizationService(config)
        with patch("app.rpc.server.watch", side_effect=fake_watch):
            handle = await _start_watcher(config, service, vis_service)
        yield captured["cb"]
        handle._task.cancel()
        try:
            await handle._task
        except (asyncio.CancelledError, Exception):
            pass

    async def test_registry_change_sends_content(
        self, config: AppConfig, callback
    ) -> None:
        mock_notify = AsyncMock()
        notifications.current_notify = mock_notify
        try:
            registry_path = str(config.get_registry_path())
            await callback({(Change.modified, registry_path)})

            calls = mock_notify.call_args_list
            methods = [c[0][0] for c in calls]
            assert "registry/didUpdate" in methods
            reg_call = next(c for c in calls if c[0][0] == "registry/didUpdate")
            params = reg_call[0][1]
            assert "registry" in params
            assert params["registry"]["version"] == "2.0"
            # Also sends file/didChange for editor refresh
            assert "file/didChange" in methods
        finally:
            notifications.current_notify = None

    async def test_spec_modified_sends_did_change(
        self, config: AppConfig, callback
    ) -> None:
        mock_notify = AsyncMock()
        notifications.current_notify = mock_notify
        try:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.modified, spec_path)})

            calls = mock_notify.call_args_list
            methods = [c[0][0] for c in calls]
            assert "spec/didChange" in methods
            spec_call = next(c for c in calls if c[0][0] == "spec/didChange")
            params = spec_call[0][1]
            assert params["id"] == "mod-a"
            assert "changes" in params
            # Also sends file/didChange for editor refresh
            assert "file/didChange" in methods
        finally:
            notifications.current_notify = None

    async def test_spec_created_sends_did_create(
        self, config: AppConfig, callback
    ) -> None:
        mock_notify = AsyncMock()
        notifications.current_notify = mock_notify
        try:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.added, spec_path)})

            calls = mock_notify.call_args_list
            method, params = calls[0][0]
            assert method == "spec/didCreate"
            assert params["id"] == "mod-a"
            assert params["path"] == "mod_a/README.md"
        finally:
            notifications.current_notify = None

    async def test_spec_deleted_sends_did_delete(
        self, config: AppConfig, callback
    ) -> None:
        mock_notify = AsyncMock()
        notifications.current_notify = mock_notify
        try:
            spec_path = str(config.get_project_root() / "mod_a" / "README.md")
            await callback({(Change.deleted, spec_path)})

            calls = mock_notify.call_args_list
            method, params = calls[0][0]
            assert method == "spec/didDelete"
            assert params["id"] == "mod-a"
        finally:
            notifications.current_notify = None

    async def test_no_notify_when_disconnected(
        self, config: AppConfig, callback
    ) -> None:
        notifications.current_notify = None
        spec_path = str(config.get_project_root() / "mod_a" / "README.md")
        await callback({(Change.modified, spec_path)})

    async def test_non_spec_file_ignored(
        self, config: AppConfig, callback
    ) -> None:
        """Non-spec files should not trigger spec/registry notifications.

        A generic ``file/didChange`` notification is still sent so that
        open editors in the frontend can refresh.
        """
        mock_notify = AsyncMock()
        notifications.current_notify = mock_notify
        try:
            random_path = str(config.get_project_root() / "some_file.py")
            await callback({(Change.modified, random_path)})
            # Should only get a generic file/didChange, no spec/registry notifications
            calls = mock_notify.call_args_list
            methods = [c[0][0] for c in calls]
            assert "spec/didChange" not in methods
            assert "spec/didCreate" not in methods
            assert "spec/didDelete" not in methods
            assert "registry/didUpdate" not in methods
        finally:
            notifications.current_notify = None
