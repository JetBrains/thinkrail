from __future__ import annotations

import json
import logging
from functools import partial
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from jsonrpcserver import async_dispatch
from watchfiles import Change

import app.rpc.notifications as notifications
from app.rpc.notifications import make_notify
from app.rpc.methods.specs import (
    create_spec,
    delete_spec,
    get_graph,
    get_spec,
    list_specs,
    update_spec,
)
from app.rpc.methods.agents import (
    end_session,
    get_agent_status,
    interrupt_agent,
    list_agents,
    respond_agent,
    run_agent,
    send_message,
)
from app.rpc.methods.sessions import (
    continue_session,
    delete_session_data,
    get_session,
    list_all_sessions,
)
from app.agent.service import AgentService
from app.core.config import AppConfig, load_config
from app.core.fileio import read_text
from app.core.watcher import WatchHandle, watch, stop
from app.spec.service import SpecService

logger = logging.getLogger(__name__)

METHODS = {
    "spec/list": list_specs,
    "spec/get": get_spec,
    "spec/create": create_spec,
    "spec/update": update_spec,
    "spec/delete": delete_spec,
    "spec/graph": get_graph,
    "agent/run": run_agent,
    "agent/send": send_message,
    "agent/status": get_agent_status,
    "agent/list": list_agents,
    "agent/interrupt": interrupt_agent,
    "agent/end": end_session,
    "agent/respond": respond_agent,
    "session/list": list_all_sessions,
    "session/get": get_session,
    "session/continue": continue_session,
    "session/delete": delete_session_data,
}

_active_ws: WebSocket | None = None
_active_watcher: WatchHandle | None = None


def _bind_methods(
    spec_service: SpecService, agent_service: AgentService
) -> dict:
    """Bind each handler in METHODS to its owning service via partial."""
    bound = {}
    for name, handler in METHODS.items():
        if name.startswith("spec/"):
            bound[name] = partial(handler, spec_service)
        else:
            bound[name] = partial(handler, agent_service)
    return bound


def register_routes(app: FastAPI) -> None:
    """Register the ``/ws`` WebSocket endpoint on the FastAPI app.

    Each connection specifies a project directory via the ``project``
    query parameter. Services and watcher are created per-connection.
    """

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        global _active_ws, _active_watcher

        # Read project path from query params
        project_param = websocket.query_params.get("project")
        if not project_param:
            await websocket.close(code=4001, reason="Missing project query parameter")
            return

        project_path = Path(project_param).expanduser().resolve()
        if not (project_path / ".specs" / "registry.json").is_file():
            await websocket.close(
                code=4002,
                reason=f"Invalid project: {project_path} has no .specs/registry.json",
            )
            return

        # Build per-connection config and services
        config = load_config(project_root=project_path)
        spec_service = SpecService(config)
        agent_service = AgentService(config, spec_service)
        bound_methods = _bind_methods(spec_service, agent_service)

        # Replace existing connection if any
        if _active_ws is not None:
            try:
                await _active_ws.close(code=4000, reason="replaced")
            except Exception:
                pass
        if _active_watcher is not None:
            try:
                await stop(_active_watcher)
            except Exception:
                pass
            _active_watcher = None

        await websocket.accept()
        _active_ws = websocket

        notify = make_notify(websocket)
        notifications.current_notify = notify

        # Start per-connection file watcher
        watcher_handle = await _start_watcher(config, spec_service)
        _active_watcher = watcher_handle

        try:
            while True:
                text = await websocket.receive_text()
                response = await async_dispatch(
                    text, methods=bound_methods
                )
                if response:
                    await websocket.send_text(response)
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected")
        finally:
            if _active_ws is websocket:
                notifications.current_notify = None
                _active_ws = None
            if _active_watcher is watcher_handle:
                try:
                    await stop(watcher_handle)
                except Exception:
                    pass
                _active_watcher = None


async def _start_watcher(config: AppConfig, service: SpecService) -> WatchHandle:
    """Start the filesystem watcher for a project directory."""
    registry_path = config.get_registry_path()

    _change_to_method = {
        Change.added: "spec/didCreate",
        Change.modified: "spec/didChange",
        Change.deleted: "spec/didDelete",
    }

    async def _on_file_change(changes: set[tuple[Change, str]]) -> None:
        notify = notifications.current_notify
        if notify is None:
            return

        for change_type, path_str in changes:
            path = Path(path_str)

            if path == registry_path:
                try:
                    registry_content = json.loads(read_text(registry_path))
                except Exception:
                    registry_content = {}
                await notify("registry/didUpdate", {"registry": registry_content})
            elif path.suffix in (".md", ".json"):
                try:
                    summaries = service.list_specs()
                except Exception:
                    continue
                spec_paths = {
                    str(config.get_project_root() / s.path): s
                    for s in summaries
                }
                summary = spec_paths.get(path_str)
                if summary is not None:
                    method = _change_to_method.get(change_type, "spec/didChange")
                    params: dict = {"id": summary.id}
                    if method == "spec/didCreate":
                        params["path"] = summary.path
                    elif method == "spec/didChange":
                        params["changes"] = {}
                    await notify(method, params)

    return await watch([config.get_project_root()], _on_file_change)
