"""Spec MCP tools — bonsai-specs server (3 tools).

Three tools giving the Claude agent structured access to the spec index.
Custom tools exist only for operations standard file tools cannot do:
querying the SQLite index and performing multi-file cleanup on delete.

Agents create and edit spec files directly using standard Write/Edit
tools — writing YAML frontmatter + Markdown content.  The file watcher
validates and indexes changes automatically.

Design reference:
    .bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md §MCP Tools Redesign
    backend/app/agent/tools/SPECS_TOOLS.md
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.index import SpecIndex
from app.spec.service import SpecNotFoundError, SpecService
from app.spec.models import RECOGNIZED_LINK_TYPES, RECOGNIZED_STATUSES, RECOGNIZED_TYPES

logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _json_ok(data: Any) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(data, indent=2)}]}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": True}


def _get_config() -> AppConfig:
    """Read AppConfig from tool context (set by runner)."""
    return get_tool_context().config


@asynccontextmanager
async def _index_service() -> AsyncIterator[SpecService]:
    """Get SpecService — prefer cached session service, fallback to fresh.

    When ``ToolContext.spec_service`` is set (normal server operation), yields
    it directly — reusing the server's cached ``SpecIndex`` connection with
    zero per-call overhead.

    Falls back to opening a fresh ``SpecIndex`` connection when
    ``spec_service`` is ``None`` (tests, edge cases).
    """
    ctx = get_tool_context()

    if ctx.spec_service is not None:
        yield ctx.spec_service
        return

    # Fallback: fresh connection (tests, edge cases)
    from app.core.config import get_index_path

    config = ctx.config
    db_path = get_index_path(config.get_project_root())
    async with SpecIndex(db_path) as index:
        yield SpecService(config, index=index)


def _is_draft_mode() -> tuple[bool, str]:
    """Check if current session should use draft mode (ticket-specify)."""
    try:
        ctx = get_tool_context()
        ticket_id = ctx.task.meta_ticket_id
        if ticket_id and ctx.task.skill_id == "ticket-specify":
            return True, ticket_id
    except Exception:
        pass
    return False, ""


def _get_draft_service():
    """Get SpecDraftService from BoardService."""
    from app.board.service import BoardService
    ctx = get_tool_context()
    return BoardService(ctx.config).spec_drafts


# ── Schemas ──────────────────────────────────────────────────────────────────

SPEC_SEARCH_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": list(RECOGNIZED_TYPES),
            "description": "Filter by spec type",
        },
        "status": {
            "type": "string",
            "enum": sorted(RECOGNIZED_STATUSES),
            "description": "Filter by lifecycle status",
        },
        "tag": {
            "type": "string",
            "description": "Filter by tag (exact match)",
        },
        "covers": {
            "type": "string",
            "description": "Filter by covered source path prefix",
        },
    },
}

SPEC_LINKS_SCHEMA: dict = {
    "type": "object",
    "required": ["ids"],
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Spec IDs to get links for",
        },
        "direction": {
            "type": "string",
            "enum": ["children", "parents", "dependencies", "dependents", "all"],
            "description": "Filter link direction (default: 'all')",
        },
        "link_type": {
            "type": "string",
            "enum": list(RECOGNIZED_LINK_TYPES),
            "description": "Filter to a specific link type (optional)",
        },
    },
}

SPEC_DELETE_SCHEMA: dict = {
    "type": "object",
    "required": ["id"],
    "properties": {
        "id": {
            "type": "string",
            "description": "Spec ID to delete",
        },
    },
}


# ── Tool handlers ────────────────────────────────────────────────────────────


@tool(
    "spec_search",
    "Discover specs by type, status, tag, or covered path. "
    "Returns summaries — use Read tool for full content.",
    SPEC_SEARCH_SCHEMA,
)
async def _spec_search(args: dict) -> dict:
    try:
        async with _index_service() as svc:
            results = await svc.list_specs(
                type=args.get("type"),
                status=args.get("status"),
                tag=args.get("tag"),
                covers=args.get("covers"),
            )
    except Exception as exc:
        return _error(f"Failed to search specs: {exc}")

    return _json_ok([
        {
            "id": s.id,
            "path": s.path,
            "title": s.title,
            "type": s.type,
            "status": s.status,
            "tags": s.tags,
        }
        for s in results
    ])


@tool(
    "spec_links",
    "Navigate relationships from known specs via the index. "
    "Returns links and summary info for all referenced nodes.",
    SPEC_LINKS_SCHEMA,
)
async def _spec_links(args: dict) -> dict:
    ids = args.get("ids", [])
    if not ids:
        return _error("Missing required parameter: ids")

    direction = args.get("direction", "all")
    link_type = args.get("link_type")

    # Map semantic direction → (index direction, implied link type).
    _DIRECTION_MAP: dict[str, tuple[str | None, str | None]] = {
        "children": ("incoming", "parent"),
        "parents": ("outgoing", "parent"),
        "dependencies": ("outgoing", "depends-on"),
        "dependents": ("incoming", "depends-on"),
        "all": (None, None),
    }
    idx_direction, implied_type = _DIRECTION_MAP.get(direction, (None, None))
    effective_link_type = implied_type or link_type

    try:
        async with _index_service() as svc:
            # Validate requested IDs with per-ID lookups (not full scan)
            for req_id in ids:
                try:
                    await svc.get_spec(req_id)
                except SpecNotFoundError:
                    return _error(f"Unknown spec ID: {req_id}")

            # SQL-level filtered link query
            matched = await svc.get_links(
                ids, direction=idx_direction, link_type=effective_link_type,
            )

            # Collect referenced node IDs and look up summaries (targeted)
            referenced_ids: set[str] = set()
            for lnk in matched:
                referenced_ids.add(lnk.from_id)
                referenced_ids.add(lnk.to_id)

            nodes = []
            for ref_id in referenced_ids:
                try:
                    detail = await svc.get_spec(ref_id)
                    nodes.append({
                        "id": detail.id,
                        "path": detail.path,
                        "title": detail.title,
                        "type": detail.type,
                        "status": detail.status,
                    })
                except SpecNotFoundError:
                    pass  # dangling link target — skip
    except Exception as exc:
        return _error(f"Failed to read specs: {exc}")

    return _json_ok({
        "links": [lnk.model_dump(by_alias=True) for lnk in matched],
        "nodes": nodes,
    })


@tool(
    "spec_delete",
    "Delete a spec with multi-file cleanup. "
    "Moves file to trash and cleans dangling references from other specs.",
    SPEC_DELETE_SCHEMA,
)
async def _spec_delete(args: dict) -> dict:
    spec_id = args.get("id", "")
    if not spec_id:
        return _error("Missing required parameter: id")

    # Draft mode: record deletion without actually deleting
    draft_mode, draft_ticket_id = _is_draft_mode()
    if draft_mode:
        try:
            async with _index_service() as svc:
                detail = await svc.get_spec(spec_id)
            draft_svc = _get_draft_service()
            draft_svc.record_delete(draft_ticket_id, detail.path, registry_id=spec_id)
            return _ok(
                f"Draft: recorded deletion of '{spec_id}' "
                f"(will be applied when you review drafts)"
            )
        except SpecNotFoundError:
            return _error(f"Spec '{spec_id}' not found")
        except Exception as exc:
            return _error(f"Failed to record draft deletion: {exc}")

    ctx = get_tool_context()
    if ctx.coordinator is not None:
        # Route through coordinator for serialized deletion (full SpecService flow)
        try:
            await ctx.coordinator.request_delete(spec_id)
        except SpecNotFoundError:
            return _error(f"Spec '{spec_id}' not found")
        except Exception as exc:
            return _error(f"Failed to delete spec: {exc}")
        return _ok(f"Deleted spec '{spec_id}'.")

    # Fallback: direct deletion (tests, edge cases without coordinator)
    try:
        async with _index_service() as svc:
            # Query referencing specs before delete so we can report cleaned files
            refs = await svc.get_referencing_specs(spec_id)
            cleaned_paths = [r.path for r in refs if r.id != spec_id]
            await svc.delete_spec(spec_id)
    except SpecNotFoundError:
        return _error(f"Spec '{spec_id}' not found")
    except Exception as exc:
        return _error(f"Failed to delete spec: {exc}")

    msg = f"Deleted spec '{spec_id}'."
    if cleaned_paths:
        files_list = ", ".join(cleaned_paths)
        msg += f" Cleaned dangling references from: {files_list}"
    else:
        msg += " No dangling references found in other specs."
    return _ok(msg)


# ── MCP server ───────────────────────────────────────────────────────────────

specs_mcp_server = create_sdk_mcp_server(
    name="bonsai-specs",
    tools=[_spec_search, _spec_links, _spec_delete],
)


async def intercept_specs(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — validation happens inside the tool handler."""
    return PermissionResultAllow(behavior="allow")
