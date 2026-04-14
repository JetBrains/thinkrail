from __future__ import annotations

import asyncio
import json
import logging
import uuid
from functools import partial
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from jsonrpcserver import async_dispatch
from watchfiles import Change

from app.rpc.auth import authenticate
from app.rpc.bus import bus
from app.rpc.connections import ClientConnection, current_conn_id
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
    subscribe_session,
    unsubscribe_session,
)
from app.rpc.methods.trash import (
    empty_trash,
    list_trashed,
    purge_trashed,
    restore_draft as trash_restore_draft,
    restore_patches as trash_restore_patches,
    restore_plan as trash_restore_plan,
    restore_spec as trash_restore_spec,
)
from app.rpc.methods.settings import (
    ensure_settings,
    get_settings,
    list_models,
    list_skills,
    refresh_models,
    update_settings,
)
from app.agent.model_registry import ModelRegistry
from app.rpc.methods.auth import create_token, list_connections, list_users
from app.rpc.methods.admin import (
    admin_create_user,
    admin_delete_user,
    admin_list_users,
    admin_remove_admin,
    admin_revoke_token,
    admin_set_admin,
)
from app.rpc.methods.user import (
    get_preferences,
    get_profile,
    get_recent_projects,
    update_preferences,
)
from app.rpc.methods.subsessions import (
    approve_summary as subsession_approve_summary,
    create_subsession as subsession_create,
    dismiss_summary as subsession_dismiss_summary,
    list_children as subsession_list_children,
    request_summary as subsession_request_summary,
    revise_summary as subsession_revise_summary,
)
from app.rpc.methods.vis import get_vis_state, recompute_vis
from app.rpc.methods.board import (
    apply_all_drafts,
    apply_draft,
    attach_session as board_attach_session,
    detach_session as board_detach_session,
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
from app.core.project import ensure_project
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
    "session/subscribe": subscribe_session,
    "session/unsubscribe": unsubscribe_session,
    "subsession/create": subsession_create,
    "subsession/requestSummary": subsession_request_summary,
    "subsession/approveSummary": subsession_approve_summary,
    "subsession/dismissSummary": subsession_dismiss_summary,
    "subsession/reviseSummary": subsession_revise_summary,
    "subsession/listChildren": subsession_list_children,
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
    "board/detachSession": board_detach_session,
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
    "trash/restoreSpec": trash_restore_spec,
    "trash/restorePlan": trash_restore_plan,
    "trash/restoreDraft": trash_restore_draft,
    "trash/restorePatches": trash_restore_patches,
    "settings/get": get_settings,
    "settings/update": update_settings,
    "settings/ensureFile": ensure_settings,
    "models/list": list_models,
    "models/refresh": refresh_models,
    "skills/list": list_skills,
    "auth/createToken": create_token,
    "auth/listUsers": list_users,
    "connection/list": list_connections,
    "admin/listUsers": admin_list_users,
    "admin/createUser": admin_create_user,
    "admin/deleteUser": admin_delete_user,
    "admin/setAdmin": admin_set_admin,
    "admin/removeAdmin": admin_remove_admin,
    "admin/revokeToken": admin_revoke_token,
    "user/getProfile": get_profile,
    "user/getPreferences": get_preferences,
    "user/updatePreferences": update_preferences,
    "user/getRecentProjects": get_recent_projects,
}

# Per-project service caches (survive WebSocket reconnects).
_agent_services: dict[str, AgentService] = {}
_vis_services: dict[str, VisualizationService] = {}
_board_services: dict[str, BoardService] = {}
_model_registries: dict[str, ModelRegistry] = {}

# Per-project watcher with reference counting.
# Maps project_path → (WatchHandle, active_connection_count)
_project_watchers: dict[str, tuple[WatchHandle, int]] = {}


def _bind_methods(
    config: AppConfig,
    spec_service: SpecService,
    agent_service: AgentService,
    vis_service: VisualizationService,
    board_service: BoardService,
    model_registry: ModelRegistry,
    trash_service: "TrashService | None" = None,
    server_store: "ServerStore | None" = None,
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
        elif name.startswith("settings/"):
            bound[name] = partial(handler, config)
        elif name.startswith("skills/"):
            bound[name] = partial(handler, config)
        elif name.startswith("models/"):
            bound[name] = partial(handler, model_registry)
        elif name.startswith("auth/") or name.startswith("connection/") or name.startswith("admin/"):
            bound[name] = partial(handler, server_store)
        elif name.startswith("user/") and server_store:
            bound[name] = partial(handler, server_store)
        else:
            bound[name] = partial(handler, agent_service)
    return bound


def register_routes(app: FastAPI, server_store: "ServerStore | None" = None) -> None:
    """Register the ``/ws`` WebSocket endpoint on the FastAPI app.

    Each connection specifies a project directory via the ``project``
    query parameter.  Multiple connections are supported simultaneously.

    *server_store* is the server-wide SQLite store for auth and user
    data.  When ``None`` (tests / legacy), a temporary in-memory store
    is created.
    """
    from app.core.server_store import ServerStore as _SS

    _server_store = server_store

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        nonlocal _server_store
        # Lazy-init for test scenarios where no store was provided
        if _server_store is None:
            _server_store = _SS(Path.home() / ".bonsai")
        # Ensure the store is open (idempotent if already open)
        if not _server_store.is_open:
            await _server_store.open()

        # Read project path from query params
        project_param = websocket.query_params.get("project")
        if not project_param:
            await websocket.close(code=4001, reason="Missing project query parameter")
            return

        project_path = Path(project_param).expanduser().resolve()
        try:
            ensure_project(project_path)
        except Exception:
            await websocket.close(
                code=4002,
                reason=f"Failed to initialize project at {project_path}",
            )
            return

        # Authenticate via token (two-tier: server-wide SQLite + project fallback)
        token_param = websocket.query_params.get("token")
        identity = await authenticate(_server_store, project_path, token_param)
        if identity is None:
            await websocket.close(
                code=4003,
                reason="Invalid or missing authentication token",
            )
            return

        # Register project in server-wide store and track user's recent projects
        project_name = project_path.name
        try:
            await _server_store.register_project(str(project_path), project_name)
            await _server_store.update_project_last_opened(str(project_path))
            await _server_store.add_recent_project(identity.user_id, str(project_path))
        except Exception:
            logger.warning("Failed to update server store on connect", exc_info=True)

        # Build per-connection config and services
        config = load_config(project_root=project_path)
        spec_service = SpecService(config)

        # Reuse existing services for this project so running tasks
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

        # Trash service for soft-delete — inject into all services
        from app.trash.service import TrashService
        trash_service = TrashService(project_root=project_path)
        agent_service.trash_service = trash_service
        board_service.trash_service = trash_service
        spec_service.trash_service = trash_service
        board_service.spec_drafts.trash_service = trash_service

        # Make board service available to agent service for auto-linking
        agent_service.board_service = board_service

        # Model registry — fetches available models from the Anthropic API
        if key in _model_registries:
            model_registry = _model_registries[key]
        else:
            from app.core.settings import load_settings
            settings = load_settings(project_path)
            model_registry = ModelRegistry(
                project_root=project_path,
                refresh_hours=settings.model_refresh_interval_hours,
            )
            _model_registries[key] = model_registry
            asyncio.create_task(model_registry.start_periodic_refresh())

        agent_service.model_registry = model_registry

        bound_methods = _bind_methods(
            config, spec_service, agent_service, vis_service,
            board_service, model_registry, trash_service,
            server_store=_server_store,
        )

        await websocket.accept()

        # Create connection and register with the EventBus
        conn_id = uuid.uuid4().hex
        notify = make_notify(websocket)
        conn = ClientConnection(
            conn_id=conn_id,
            user_id=identity.user_id,
            display_name=identity.display_name,
            ws=websocket,
            notify=notify,
            project_path=key,
        )
        bus.register(conn)

        # Start the sweep task if not already running
        bus.start_sweep()

        project_topic = f"project:{key}"

        # Notify existing clients BEFORE subscribing the new one,
        # so the joining client doesn't receive its own join notification.
        await bus.publish(project_topic, "connection/didJoin", {
            "connId": conn_id,
            "userId": conn.user_id,
            "displayName": conn.display_name,
        })

        # Now subscribe the new connection to the project topic
        bus.subscribe(conn_id, project_topic)

        # Phase 1: auto-subscribe to all active session topics so every
        # client receives events for every session.  Phase 3 will restrict
        # this to explicit subscriptions.
        for task in agent_service.list_tasks():
            bus.subscribe(conn_id, f"session:{task.bonsai_sid}")

        # Bind vis service to publish via bus for file-change-driven updates.
        # Initial state is fetched on-demand by the frontend via vis/state.
        async def _vis_notify(method: str, params: dict) -> None:
            await bus.publish(project_topic, method, params)

        vis_service.bind_notify(_vis_notify)
        vis_service.refresh()  # Compute state silently on connect (no push)

        # Start or ref-count the per-project file watcher
        await _acquire_watcher(key, config, spec_service, vis_service)

        # Replay missed events if the client provides a last_seen timestamp
        last_seen = websocket.query_params.get("last_seen")
        if last_seen:
            try:
                since = float(last_seen)
                await bus.replay(conn_id, project_topic, since)
            except (ValueError, TypeError):
                pass

        try:
            while True:
                text = await websocket.receive_text()
                # Set connection context so RPC handlers know who's calling
                token = current_conn_id.set(conn_id)
                try:
                    response = await async_dispatch(
                        text, methods=bound_methods
                    )
                finally:
                    current_conn_id.reset(token)
                if response:
                    await websocket.send_text(response)
        except WebSocketDisconnect:
            logger.info("WebSocket client %s disconnected", conn_id[:8])
        finally:
            # Notify other clients before unregistering
            try:
                await bus.publish(project_topic, "connection/didLeave", {
                    "connId": conn_id,
                    "userId": conn.user_id,
                    "displayName": conn.display_name,
                })
            except Exception:
                pass
            bus.unregister(conn_id)
            await _release_watcher(key)


# -- Per-project watcher management -------------------------------------------

async def _acquire_watcher(
    project_key: str,
    config: AppConfig,
    spec_service: SpecService,
    vis_service: VisualizationService,
) -> None:
    """Start or ref-count a per-project file watcher."""
    if project_key in _project_watchers:
        handle, count = _project_watchers[project_key]
        _project_watchers[project_key] = (handle, count + 1)
    else:
        handle = await _start_watcher(project_key, config, spec_service, vis_service)
        _project_watchers[project_key] = (handle, 1)


async def _release_watcher(project_key: str) -> None:
    """Decrement ref count and stop watcher when no connections remain."""
    entry = _project_watchers.get(project_key)
    if entry is None:
        return
    handle, count = entry
    if count <= 1:
        try:
            await stop(handle)
        except Exception:
            pass
        del _project_watchers[project_key]
    else:
        _project_watchers[project_key] = (handle, count - 1)


async def _start_watcher(
    project_key: str,
    config: AppConfig,
    service: SpecService,
    vis_service: VisualizationService,
) -> WatchHandle:
    """Start the filesystem watcher for a project directory."""
    registry_path = config.get_registry_path()
    project_topic = f"project:{project_key}"

    _change_to_method = {
        Change.added: "spec/didCreate",
        Change.modified: "spec/didChange",
        Change.deleted: "spec/didDelete",
    }

    async def _on_file_change(changes: set[tuple[Change, str]]) -> None:
        for change_type, path_str in changes:
            path = Path(path_str)

            if path == registry_path:
                try:
                    registry_content = json.loads(read_text(registry_path))
                except Exception:
                    registry_content = {}
                await bus.publish(project_topic, "registry/didUpdate", {"registry": registry_content})
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
                    await bus.publish(project_topic, method, params)
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
            await bus.publish(project_topic, "files/treeChanged", {})

        # Notify frontend about modified files so open editors can refresh
        for change_type, path_str in changes:
            if change_type == Change.modified:
                rel = str(Path(path_str).relative_to(config.get_project_root()))
                await bus.publish(project_topic, "file/didChange", {"path": rel})

        # Recompute dashboard on any .md/.json change (specs, tasks, registry)
        if any(Path(p).suffix in (".md", ".json") for _, p in changes):
            await vis_service.recompute()

    return await watch([config.get_project_root()], _on_file_change)
