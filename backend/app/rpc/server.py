from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.runtime import RuntimeRegistry

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from jsonrpcserver import async_dispatch
from watchfiles import Change

from app.rpc.bus import bus
from app.rpc.connections import ClientConnection
from app.rpc.context import current_conn_id
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
    retry_last_message,
    run_agent,
    send_message,
    revise_transcript_rpc,
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
    patch_outcome_action,
    restart_session,
    subscribe_session,
    unsubscribe_session,
)
from app.rpc.methods.settings import (
    ensure_settings,
    get_session_defaults,
    get_settings,
    list_runtime_skills,
    list_skills,
    runtimes_capabilities,
    runtimes_list,
    set_session_defaults,
    update_settings,
)
from app.rpc.methods.subsessions import (
    approve_summary as subsession_approve_summary,
    create_subsession as subsession_create,
    dismiss_summary as subsession_dismiss_summary,
    list_children as subsession_list_children,
    request_summary as subsession_request_summary,
    revise_summary as subsession_revise_summary,
)
from app.rpc.methods.board import (
    attach_session as board_attach_session,
    create_plan,
    create_ticket,
    delete_ticket,
    detach_session as board_detach_session,
    get_history as board_get_history,
    get_next_step,
    get_plan,
    get_plan_raw,
    get_ticket,
    link_spec as board_link_spec,
    list_tickets,
    read_artifact,
    reorder_ticket as board_reorder_ticket,
    save_plan,
    save_plan_raw,
    set_orchestrator as board_set_orchestrator,
    skip_phase as board_skip_phase,
    unlink_spec as board_unlink_spec,
    unskip_phase as board_unskip_phase,
    update_step,
    update_ticket,
)
from app.agent.persistence import has_persisted_sessions
from app.core.config import AppConfig, BONSAI_DIRNAME, load_config
from app.core.watcher import WatchHandle, watch
from app.core.bonsaihide import load_bonsaihide
from app.rpc.project_context import ProjectContext
from app.spec.coordinator import FileChanged, IndexCoordinator
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
    "agent/prepare": prepare_agent,
    "agent/updateDraft": update_draft,
    "agent/startDraft": start_draft,
    "agent/send": send_message,
    "agent/retryLastMessage": retry_last_message,
    "agent/status": get_agent_status,
    "agent/list": list_agents,
    "agent/interrupt": interrupt_agent,
    "agent/end": end_session,
    "agent/respond": respond_agent,
    "agent/updateConfig": update_config,
    "agent/transcribe": transcribe_audio,
    "agent/reviseTranscript": revise_transcript_rpc,
    "session/list": list_all_sessions,
    "session/get": get_session,
    "session/continue": continue_session,
    "session/restart": restart_session,
    "session/delete": delete_session_data,
    "session/subscribe": subscribe_session,
    "session/unsubscribe": unsubscribe_session,
    "session/patchOutcomeAction": patch_outcome_action,
    "subsession/create": subsession_create,
    "subsession/requestSummary": subsession_request_summary,
    "subsession/approveSummary": subsession_approve_summary,
    "subsession/dismissSummary": subsession_dismiss_summary,
    "subsession/reviseSummary": subsession_revise_summary,
    "subsession/listChildren": subsession_list_children,
    "board/list": list_tickets,
    "board/get": get_ticket,
    "board/create": create_ticket,
    "board/update": update_ticket,
    "board/delete": delete_ticket,
    "board/linkSpec": board_link_spec,
    "board/unlinkSpec": board_unlink_spec,
    "board/attachSession": board_attach_session,
    "board/detachSession": board_detach_session,
    "board/setOrchestrator": board_set_orchestrator,
    "board/skipPhase": board_skip_phase,
    "board/unskipPhase": board_unskip_phase,
    "board/getPlan": get_plan,
    "board/createPlan": create_plan,
    "board/savePlan": save_plan,
    "board/getPlanRaw": get_plan_raw,
    "board/savePlanRaw": save_plan_raw,
    "board/updateStep": update_step,
    "board/getNextStep": get_next_step,
    "board/reorder": board_reorder_ticket,
    "board/readArtifact": read_artifact,
    "board/getHistory": board_get_history,
    "settings/get": get_settings,
    "settings/update": update_settings,
    "settings/ensureFile": ensure_settings,
    "appSettings/getSessionDefaults": get_session_defaults,
    "appSettings/setSessionDefaults": set_session_defaults,
    "runtimes/list": runtimes_list,
    "runtimes/capabilities": runtimes_capabilities,
    "skills/list": list_skills,
    "skills/listRuntime": list_runtime_skills,
}

# Per-project service container (survives WebSocket reconnects).
_projects: dict[str, ProjectContext] = {}

# Guards _projects dict access.  threading.Lock (not asyncio.Lock) because
# Starlette's TestClient runs each websocket_connect() on a separate event
# loop — asyncio primitives deadlock across loops.  The lock is held only
# for sync dict operations, never across an await.
_projects_lock = threading.Lock()


def _bind_methods(
    config: AppConfig,
    spec_service: SpecService,
    agent_service: AgentService,
    board_service: BoardService,
    runtime_registry: "RuntimeRegistry",
    app_store: "AppStore",
) -> dict:
    """Bind each handler in METHODS to its owning service via partial."""
    bound = {}
    for name, handler in METHODS.items():
        if name.startswith("spec/"):
            bound[name] = partial(handler, spec_service)
        elif name.startswith("board/"):
            bound[name] = partial(handler, board_service)
        elif name == "appSettings/getSessionDefaults":
            bound[name] = partial(handler, app_store, runtime_registry)
        elif name.startswith("appSettings/"):
            bound[name] = partial(handler, app_store)
        elif name.startswith("settings/"):
            bound[name] = partial(handler, config)
        elif name == "skills/listRuntime":
            # Runtime skill discovery is dispatched by ``RuntimeRegistry``,
            # not the project config — keep this branch *before* the
            # ``skills/`` prefix fallback so the right service is injected.
            bound[name] = partial(handler, runtime_registry)
        elif name.startswith("skills/"):
            bound[name] = partial(handler, config)
        elif name.startswith("runtimes/"):
            bound[name] = partial(handler, runtime_registry)
        else:
            bound[name] = partial(handler, agent_service)
    return bound


def register_routes(app: FastAPI, app_store: "AppStore | None" = None) -> None:
    """Register the ``/ws`` WebSocket endpoint on the FastAPI app.

    Each connection specifies a project directory via the ``project``
    query parameter.  Multiple connections are supported simultaneously.

    *app_store* is the app-wide SQLite store used to track known
    projects.  When ``None`` (tests / legacy), a temporary store is
    created lazily inside ``~/.bonsai``.
    """
    from app.core.app_store import AppStore as _AS

    _app_store = app_store

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket) -> None:
        nonlocal _app_store
        # Lazy-init for test scenarios where no store was provided
        if _app_store is None:
            _app_store = _AS(Path.home() / BONSAI_DIRNAME)
        # Ensure the store is open (idempotent if already open)
        if not _app_store.is_open:
            await _app_store.open()

        # Read project path from query params
        project_param = websocket.query_params.get("project")
        if not project_param:
            await websocket.close(code=4001, reason="Missing project query parameter")
            return

        project_path = Path(project_param).expanduser().resolve()
        if not project_path.is_dir():
            await websocket.close(
                code=4002,
                reason=f"Project directory does not exist: {project_path}",
            )
            return

        # Recent-projects list is keyed on real work, not folder access.
        # Background artifacts (model cache, etc.) don't count.
        project_name = project_path.name
        project_registered = has_persisted_sessions(project_path)
        if project_registered:
            try:
                await _app_store.register_project(str(project_path), project_name)
            except Exception:
                logger.warning("Failed to update app store on connect", exc_info=True)

        # Accept immediately — within frontend's 5s connectTimeout
        await websocket.accept()

        # Build per-connection config and services
        config = load_config(project_root=project_path)
        key = str(project_path)

        # Register connection with EventBus immediately after accept
        # (before ctx.start() which does I/O).  Subscribing to topics
        # happens later — register just makes the connection visible.
        conn_id = uuid.uuid4().hex
        notify = make_notify(websocket)
        conn = ClientConnection(
            conn_id=conn_id,
            user_id="local",
            display_name="Local",
            ws=websocket,
            notify=notify,
            project_path=key,
        )
        bus.register(conn)
        bus.start_sweep()

        # Reuse existing ProjectContext for this project so running tasks
        # survive WebSocket reconnects (page refresh, network blip).
        project_topic = f"project:{key}"
        ctx: ProjectContext | None = None
        try:
            # Sync-only dict guard — no await inside the lock.
            with _projects_lock:
                if key in _projects:
                    ctx = _projects[key]
                    ctx.connection_count += 1

            # No existing context — create and start before storing.
            # This ensures a failed start() never leaves a broken context
            # in _projects for other connections to find.
            if ctx is None:
                async def _coordinator_notify(method: str, params: dict) -> None:
                    await bus.publish(project_topic, method, params)

                new_ctx = ProjectContext(
                    key, project_path, config,
                    notify_fn=_coordinator_notify,
                    watcher_factory=_start_watcher,
                )
                await new_ctx.start()

                # Store only after start() succeeds.  Re-check under lock
                # in case another connection raced us.
                with _projects_lock:
                    if key in _projects:
                        # Another connection created this project concurrently.
                        # Discard ours, use theirs.
                        ctx = _projects[key]
                        ctx.connection_count += 1
                        # Shut down our duplicate outside the lock.
                        asyncio.create_task(new_ctx.shutdown())
                    else:
                        ctx = new_ctx
                        _projects[key] = ctx
                        ctx.connection_count += 1

            bound_methods = _bind_methods(
                config, ctx.spec_service, ctx.agent_service,
                ctx.board_service, ctx.runtime_registry, _app_store,
            )

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
            for task in ctx.agent_service.list_tasks():
                bus.subscribe(conn_id, f"session:{task.bonsai_sid}")

            # Start background services (coordinator, watcher, model registry).
            # Idempotent — second connection's call is a no-op.
            await ctx.start_services()

            # Replay missed events if the client provides a last_seen timestamp
            last_seen = websocket.query_params.get("last_seen")
            if last_seen:
                try:
                    since = float(last_seen)
                    await bus.replay(conn_id, project_topic, since)
                except (ValueError, TypeError):
                    pass

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
                # Lazy registration: surface the project in the recent
                # list once a handler has persisted its first session.
                if not project_registered and has_persisted_sessions(project_path):
                    try:
                        await _app_store.register_project(str(project_path), project_name)
                        project_registered = True
                    except Exception:
                        logger.warning("Failed to register project after first session", exc_info=True)
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
            if ctx is not None:
                with _projects_lock:
                    ctx.connection_count -= 1


# -- Watcher helpers -----------------------------------------------------------

async def _validate_frontmatter_and_notify(
    path: Path, project_root: Path, project_topic: str,
) -> None:
    """Parse frontmatter from a changed .md file and push validation errors.

    Implements the watcher validation hook described in the design doc
    (§Watcher Validation Hook).  Errors and warnings are sent as
    ``spec/validationError`` notifications so agents get immediate feedback.
    """
    from app.spec.frontmatter import FrontmatterError, parse_frontmatter, validate_frontmatter

    rel_path = str(path.relative_to(project_root))
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return

    try:
        meta, _ = parse_frontmatter(content)
    except FrontmatterError as exc:
        await bus.publish(project_topic, "spec/validationError", {
            "path": rel_path,
            "errors": [{"field": "frontmatter", "message": str(exc), "severity": "error"}],
            "warnings": [],
        })
        return

    if not meta:
        return  # No frontmatter — unmanaged document, no validation needed

    errors_list: list[dict] = []
    warnings_list: list[dict] = []

    validation_errors = validate_frontmatter(meta)
    for msg in validation_errors:
        severity = "error" if ("Missing" in msg or "empty required" in msg) else "warning"
        field_name = ""
        if "'id'" in msg:
            field_name = "id"
        elif "'type'" in msg:
            field_name = "type"
        elif "'status'" in msg:
            field_name = "status"
        entry = {"field": field_name, "message": msg, "severity": severity}
        if severity == "error":
            errors_list.append(entry)
        else:
            warnings_list.append(entry)

    if errors_list or warnings_list:
        await bus.publish(project_topic, "spec/validationError", {
            "path": rel_path,
            "errors": errors_list,
            "warnings": warnings_list,
        })


async def _start_watcher(
    project_key: str,
    config: AppConfig,
    service: SpecService,
    coordinator: IndexCoordinator,
) -> WatchHandle:
    """Start the filesystem watcher for a project directory."""
    project_topic = f"project:{project_key}"

    _change_to_method = {
        Change.added: "spec/didCreate",
        Change.modified: "spec/didChange",
        Change.deleted: "spec/didDelete",
    }

    async def _on_file_change(changes: set[tuple[Change, str]]) -> None:
        project_root = config.get_project_root()

        # .bonsaihide change handling runs FIRST so that any .md events in the
        # same watcher batch are evaluated against the *new* hide rules.
        #
        # We accept every change type, not just Change.modified: most modern
        # editors save by write-temp + rename(2), which watchfiles reports as
        # Change.added (and on some platforms Change.deleted + Change.added)
        # rather than Change.modified.  Deleting .bonsaihide is also a real
        # change — load_bonsaihide() falls back to defaults when the file is
        # absent.
        bonsaihide_changed = any(
            Path(p).name == ".bonsaihide" for _, p in changes
        )
        if bonsaihide_changed:
            new_spec = load_bonsaihide(project_root)
            # Update the index's in-memory rules *synchronously* before any
            # FileChanged events from this batch are emitted, so reindex_file()
            # sees the new rules immediately.  Without this, same-batch
            # `git mv foo.md notes/foo.md` (with notes/ newly hidden) would
            # transiently index foo.md at its new path until the 500ms-debounced
            # rebuild fires.
            coordinator.update_bonsaihide_spec(new_spec)
            # Still request a debounced full rebuild — needed to evict entries
            # that were already indexed but are now hidden by the new rules.
            coordinator.request_rebuild(bonsaihide_spec=new_spec, reason="bonsaihide changed")

        for change_type, path_str in changes:
            path = Path(path_str)

            if path.suffix == ".md":
                # Validate frontmatter on .md file changes (read-only, not a mutation)
                if change_type in (Change.added, Change.modified):
                    await _validate_frontmatter_and_notify(
                        path, project_root, project_topic,
                    )

                # Emit FileChanged to coordinator — coordinator handles reindex + notification
                deleted = (change_type == Change.deleted)
                coordinator.emit(FileChanged(path=path, deleted=deleted))

            elif path.suffix == ".json":
                # .json files — use existing spec lookup for notifications
                try:
                    summaries = await service.list_specs()
                except Exception:
                    continue
                spec_paths = {
                    str(project_root / s.path): s
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

        if any(ct in (Change.added, Change.deleted) for ct, _ in changes):
            await bus.publish(project_topic, "files/treeChanged", {})
        elif bonsaihide_changed:
            await bus.publish(project_topic, "files/treeChanged", {})

        # Notify frontend about modified files so open editors can refresh
        for change_type, path_str in changes:
            if change_type == Change.modified:
                rel = str(Path(path_str).relative_to(config.get_project_root()))
                await bus.publish(project_topic, "file/didChange", {"path": rel})

    return await watch([config.get_project_root()], _on_file_change)
