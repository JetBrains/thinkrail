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
    prepare_agent,
    respond_agent,
    run_agent,
    send_message,
    start_draft,
    transcribe_audio,
    update_config,
    update_draft,
)
from app.rpc.methods.sessions import (
    continue_session,
    delete_session_data,
    get_session,
    list_all_sessions,
    restart_session,
    restore_session,
)
from app.rpc.methods.trash import (
    empty_trash,
    list_trashed,
    purge_trashed,
)
from app.rpc.methods.vis import get_vis_state, recompute_vis
from app.rpc.methods.board import (
    apply_all_drafts,
    apply_draft,
    attach_session as board_attach_session,
    create_plan,
    create_ticket,
    delete_ticket,
    discard_all_drafts,
    discard_draft,
    get_draft_diff,
    get_next_step,
    get_patch_diff,
    get_plan,
    get_plan_raw,
    get_ticket,
    link_spec as board_link_spec,
    list_drafts,
    list_patches,
    list_tickets,
    reorder_ticket as board_reorder_ticket,
    revert_patch,
    save_plan,
    save_plan_raw,
    set_orchestrator as board_set_orchestrator,
    set_plan_path as board_set_plan_path,
    unlink_spec as board_unlink_spec,
    update_step,
    update_ticket,
)
from app.agent.service import AgentService
from app.board.service import BoardService
from app.core.config import AppConfig, load_config
from app.core.fileio import read_text
from app.core.watcher import WatchHandle, watch, stop
from app.spec.service import SpecService, detect_spec_type
from app.vis.service import VisualizationService

logger = logging.getLogger(__name__)

METHODS = {
    "spec/list": list_specs,
    "spec/get": get_spec,
    "spec/create": create_spec,
    "spec/update": update_spec,
    "spec/delete": delete_spec,
    "spec/graph": get_graph,
    "agent/run": run_agent,
    "agent/prepare": prepare_agent,
    "agent/updateDraft": update_draft,
    "agent/startDraft": start_draft,
    "agent/send": send_message,
    "agent/status": get_agent_status,
    "agent/list": list_agents,
    "agent/interrupt": interrupt_agent,
    "agent/end": end_session,
    "agent/respond": respond_agent,
    "agent/updateConfig": update_config,
    "agent/transcribe": transcribe_audio,
    "session/list": list_all_sessions,
    "session/get": get_session,
    "session/continue": continue_session,
    "session/restart": restart_session,
    "session/delete": delete_session_data,
    "session/restore": restore_session,
    "vis/state": get_vis_state,
    "vis/recompute": recompute_vis,
    "board/list": list_tickets,
    "board/get": get_ticket,
    "board/create": create_ticket,
    "board/update": update_ticket,
    "board/delete": delete_ticket,
    "board/linkSpec": board_link_spec,
    "board/unlinkSpec": board_unlink_spec,
    "board/attachSession": board_attach_session,
    "board/setPlanPath": board_set_plan_path,
    "board/setOrchestrator": board_set_orchestrator,
    "board/getPlan": get_plan,
    "board/createPlan": create_plan,
    "board/savePlan": save_plan,
    "board/getPlanRaw": get_plan_raw,
    "board/savePlanRaw": save_plan_raw,
    "board/updateStep": update_step,
    "board/getNextStep": get_next_step,
    "board/listDrafts": list_drafts,
    "board/getDraftDiff": get_draft_diff,
    "board/applyDraft": apply_draft,
    "board/applyAllDrafts": apply_all_drafts,
    "board/discardDraft": discard_draft,
    "board/discardAllDrafts": discard_all_drafts,
    "board/listPatches": list_patches,
    "board/getPatchDiff": get_patch_diff,
    "board/revertPatch": revert_patch,
    "board/reorder": board_reorder_ticket,
    "trash/list": list_trashed,
    "trash/purge": purge_trashed,
    "trash/empty": empty_trash,
}

_active_ws: WebSocket | None = None
_active_watcher: WatchHandle | None = None
_agent_services: dict[str, AgentService] = {}
_vis_services: dict[str, VisualizationService] = {}
_board_services: dict[str, BoardService] = {}


def _bind_methods(
    spec_service: SpecService,
    agent_service: AgentService,
    vis_service: VisualizationService,
    board_service: BoardService,
    trash_service: "TrashService | None" = None,
) -> dict:
    """Bind each handler in METHODS to its owning service via partial."""
    bound = {}
    for name, handler in METHODS.items():
        if name.startswith("spec/"):
            bound[name] = partial(handler, spec_service)
        elif name.startswith("vis/"):
            bound[name] = partial(handler, vis_service)
        elif name.startswith("board/"):
            bound[name] = partial(handler, board_service)
        elif name.startswith("trash/") and trash_service:
            bound[name] = partial(handler, trash_service)
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

        # Reuse existing AgentService for this project so running tasks
        # survive WebSocket reconnects (page refresh, network blip).
        key = str(project_path)
        if key in _agent_services:
            agent_service = _agent_services[key]
        else:
            agent_service = AgentService(config, spec_service)
            _agent_services[key] = agent_service

        if key in _vis_services:
            vis_service = _vis_services[key]
        else:
            vis_service = VisualizationService(config)
            _vis_services[key] = vis_service

        if key in _board_services:
            board_service = _board_services[key]
        else:
            board_service = BoardService(config)
            _board_services[key] = board_service

        # Trash service for soft-delete
        from app.trash.service import TrashService
        trash_service = TrashService(project_root=project_path)
        agent_service.trash_service = trash_service
        board_service.trash_service = trash_service

        # Make board service available to agent service for auto-linking
        agent_service.board_service = board_service

        bound_methods = _bind_methods(spec_service, agent_service, vis_service, board_service, trash_service)

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

        # Point all running tasks at the fresh WebSocket callback
        agent_service.rebind_notify(notify)

        # Bind vis service to current WebSocket for file-change-driven updates.
        # Initial state is fetched on-demand by the frontend via vis/state.
        async def _vis_notify(method: str, params: dict) -> None:
            await notify(method, params)

        vis_service.bind_notify(_vis_notify)
        vis_service.refresh()  # Compute state silently on connect (no push)

        # Start per-connection file watcher
        watcher_handle = await _start_watcher(config, spec_service, vis_service)
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


async def _start_watcher(
    config: AppConfig, service: SpecService, vis_service: VisualizationService
) -> WatchHandle:
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
                elif change_type == Change.added and path.suffix == ".md":
                    spec_type = detect_spec_type(path.name)
                    if spec_type:
                        rel = str(path.relative_to(config.get_project_root()))
                        try:
                            service.register_existing(rel, spec_type)
                        except Exception:
                            pass  # best-effort

        bonsaihide_modified = any(
            ct == Change.modified and Path(p).name == ".bonsaihide"
            for ct, p in changes
        )
        if bonsaihide_modified or any(ct in (Change.added, Change.deleted) for ct, _ in changes):
            await notify("files/treeChanged", {})

        # Notify frontend about modified files so open editors can refresh
        for change_type, path_str in changes:
            if change_type == Change.modified:
                rel = str(Path(path_str).relative_to(config.get_project_root()))
                await notify("file/didChange", {"path": rel})

        # Recompute dashboard on any .md/.json change (specs, tasks, registry)
        if any(Path(p).suffix in (".md", ".json") for _, p in changes):
            await vis_service.recompute()

    return await watch([config.get_project_root()], _on_file_change)
