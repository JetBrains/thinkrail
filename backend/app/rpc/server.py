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
    get_agent_status,
    interrupt_agent,
    list_agents,
    respond_agent,
    run_agent,
)
from app.agent.service import AgentService
from app.core.config import AppConfig
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
    "agent/status": get_agent_status,
    "agent/list": list_agents,
    "agent/interrupt": interrupt_agent,
    "agent/respond": respond_agent,
}

_active_ws: WebSocket | None = None


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


def register_routes(app: FastAPI, config: AppConfig) -> None:
    """Register the ``/ws`` WebSocket endpoint on the FastAPI app."""
    spec_service = SpecService(config)
    agent_service = AgentService(config, spec_service)
    bound_methods = _bind_methods(spec_service, agent_service)

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        global _active_ws

        # Replace existing connection if any
        if _active_ws is not None:
            try:
                await _active_ws.close(code=4000, reason="replaced")
            except Exception:
                pass

        await websocket.accept()
        _active_ws = websocket

        notify = make_notify(websocket)
        notifications.current_notify = notify

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
            # Only clear if we're still the active connection
            if _active_ws is websocket:
                notifications.current_notify = None
                _active_ws = None


async def start_watcher(config: AppConfig) -> WatchHandle:
    """Start the filesystem watcher on the project directory."""
    service = SpecService(config)
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
                # Check if this path is a known spec file
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


async def stop_watcher(handle: WatchHandle) -> None:
    """Stop the filesystem watcher."""
    await stop(handle)
