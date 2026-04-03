"""Spec & registry MCP tools — bonsai-specs server.

7 tools giving the Claude agent structured, validated access to the spec
registry and spec files.  All tools are auto-approved; validation errors
are returned as ``isError`` MCP responses, never as permission denials.

Uses ``get_tool_context()`` to access AppConfig — works in all permission
modes including ``bypassPermissions`` (yolo).
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
from app.agent.tools._context import get_tool_context
from app.agent.tracker import Tracker
from app.core.config import AppConfig
from app.spec.models import Link, RegistryEntry
from app.spec.registry import (
    add_entry,
    find_entry,
    read_registry,
    remove_entry,
    write_registry,
)
from app.core.fileio import read_text
from app.spec.service import SpecNotFoundError, SpecService, _extract_title
from app.spec.validator import RECOGNIZED_LINK_TYPES, RECOGNIZED_TYPES

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ok(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}]}


def _json_ok(data: Any) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(data, indent=2)}]}


def _error(text: str) -> dict:
    return {"content": [{"type": "text", "text": text}], "isError": True}


def _get_config():
    """Read AppConfig from tool context (set by runner)."""
    return get_tool_context().config


def _get_service() -> SpecService:
    return SpecService(_get_config())


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


def _auto_link_spec_to_ticket(spec_id: str) -> None:
    """If the current session is attached to a meta-ticket, link the spec."""
    try:
        ctx = get_tool_context()
        ticket_id = ctx.task.meta_ticket_id
        if not ticket_id:
            return
        from app.board.service import BoardService
        board_svc = BoardService(ctx.config)
        board_svc.link_spec(ticket_id, spec_id)
    except Exception:
        logger.debug("Auto-link spec %s to ticket failed (non-critical)", spec_id)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

SPEC_LIST_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": list(RECOGNIZED_TYPES),
            "description": "Filter by spec type",
        },
        "status": {
            "type": "string",
            "enum": ["draft", "active", "stale", "done", "deprecated"],
            "description": "Filter by status",
        },
        "tag": {
            "type": "string",
            "description": "Filter by tag (exact match)",
        },
    },
}

SPEC_GET_SCHEMA: dict = {
    "type": "object",
    "required": ["id"],
    "properties": {
        "id": {
            "type": "string",
            "description": "Spec ID to retrieve",
        },
    },
}

SPEC_SAVE_SCHEMA: dict = {
    "type": "object",
    "required": ["path"],
    "properties": {
        "path": {
            "type": "string",
            "description": "Relative path from project root (e.g. 'backend/app/foo/README.md')",
        },
        "content": {
            "type": "string",
            "description": (
                "Full spec file content (Markdown). "
                "Required for new specs. Optional for updates — when omitted, "
                "spec_save reads current content from disk and syncs the registry "
                "without rewriting the file."
            ),
        },
        "type": {
            "type": "string",
            "enum": list(RECOGNIZED_TYPES),
            "description": "Spec type. Required for new specs, optional for updates.",
        },
        "id": {
            "type": "string",
            "description": "Explicit spec ID. If omitted, auto-generated from title.",
        },
        "title": {
            "type": "string",
            "description": (
                "Override the registry title. If omitted, auto-derived from "
                "the first # heading in the content."
            ),
        },
        "status": {
            "type": "string",
            "enum": ["draft", "active", "stale", "done", "deprecated"],
            "description": "Status to set. Defaults to 'draft' for new, unchanged for updates.",
        },
        "covers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Source directories this spec covers",
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Classification tags",
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

SPEC_LINKS_SCHEMA: dict = {
    "type": "object",
    "required": ["ids"],
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Spec IDs to get links for",
        },
        "link_type": {
            "type": "string",
            "enum": list(RECOGNIZED_LINK_TYPES),
            "description": "Filter to a specific link type (optional)",
        },
        "direction": {
            "type": "string",
            "enum": ["both", "outgoing", "incoming"],
            "description": "Filter link direction relative to the given IDs (default: 'both')",
        },
    },
}

REGISTRY_QUERY_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "description": "Filter by spec type",
        },
        "status": {
            "type": "string",
            "description": "Filter by status",
        },
        "tag": {
            "type": "string",
            "description": "Filter entries that have this tag",
        },
        "covers": {
            "type": "string",
            "description": "Filter entries whose covers include this path prefix",
        },
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Return only these specific IDs",
        },
        "include_links": {
            "type": "boolean",
            "description": "Include related links in response (default: false)",
        },
    },
}

REGISTRY_MUTATE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "add_entries": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type", "path", "title"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string"},
                    "path": {"type": "string"},
                    "title": {"type": "string"},
                    "status": {"type": "string"},
                    "covers": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            },
            "description": "New entries to add",
        },
        "update_entries": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "description": "ID of entry to update"},
                    "status": {"type": "string"},
                    "title": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "covers": {"type": "array", "items": {"type": "string"}},
                },
            },
            "description": "Existing entries to update (only specified fields change)",
        },
        "remove_entries": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Entry IDs to remove (also removes their links)",
        },
        "add_links": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to", "type"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": list(RECOGNIZED_LINK_TYPES),
                    },
                },
            },
            "description": "New links to add",
        },
        "remove_links": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to", "type"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {"type": "string"},
                },
            },
            "description": "Links to remove (exact match on from+to+type)",
        },
    },
}


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


@tool(
    "spec_list",
    "List specs with optional filtering by type, status, or tag. "
    "Returns summaries without content — use spec_get for full content.",
    SPEC_LIST_SCHEMA,
)
async def _spec_list(args: dict) -> dict:
    try:
        svc = _get_service()
        summaries = svc.list_specs()
    except Exception as exc:
        return _error(f"Failed to list specs: {exc}")

    # Apply filters
    filter_type = args.get("type")
    filter_status = args.get("status")
    filter_tag = args.get("tag")

    results = summaries
    if filter_type:
        results = [s for s in results if s.type == filter_type]
    if filter_status:
        results = [s for s in results if s.status == filter_status]
    if filter_tag:
        results = [s for s in results if filter_tag in s.tags]

    return _json_ok([s.model_dump() for s in results])


@tool(
    "spec_get",
    "Get a spec's full content, metadata, and related links by ID.",
    SPEC_GET_SCHEMA,
)
async def _spec_get(args: dict) -> dict:
    spec_id = args.get("id", "")
    if not spec_id:
        return _error("Missing required parameter: id")
    try:
        svc = _get_service()
        detail = svc.get_spec(spec_id)

        # Read-through: if in draft mode, overlay draft content
        draft_mode, draft_ticket_id = _is_draft_mode()
        if draft_mode and detail.path:
            draft_svc = _get_draft_service()
            draft_content = draft_svc.read_draft(draft_ticket_id, detail.path)
            if draft_content is not None:
                detail.content = draft_content

    except SpecNotFoundError:
        return _error(f"Spec '{spec_id}' not found")
    except Exception as exc:
        return _error(f"Failed to get spec: {exc}")

    return _json_ok(detail.model_dump(by_alias=True))


@tool(
    "spec_save",
    "Create or update a spec file and its registry entry atomically. "
    "If the path matches an existing entry, updates it; otherwise creates new.",
    SPEC_SAVE_SCHEMA,
)
async def _spec_save(args: dict) -> dict:
    path = args.get("path", "")
    content = args.get("content", "")
    if not path:
        return _error("Missing required parameter: path")

    # ── Draft mode: redirect writes to shadow directory ──
    draft_mode, draft_ticket_id = _is_draft_mode()
    if draft_mode and content:
        try:
            config = _get_config()
            draft_svc = _get_draft_service()
            registry_path = config.get_registry_path()
            entries, _links = read_registry(registry_path)
            existing = next((e for e in entries if e.path == path), None)

            operation = "update" if existing else "create"
            ctx = get_tool_context()

            entry = draft_svc.write_draft(
                ticket_id=draft_ticket_id,
                real_path=path,
                content=content,
                operation=operation,
                registry_id=existing.id if existing else args.get("id", ""),
                registry_type=args.get("type", existing.type if existing else ""),
                registry_title=args.get("title", _extract_title(content, path)),
                registry_covers=args.get("covers", existing.covers if existing else []),
                registry_tags=args.get("tags", existing.tags if existing else []),
                session_id=ctx.task.bonsai_sid,
            )

            # Auto-link spec to ticket
            if existing:
                _auto_link_spec_to_ticket(existing.id)

            return _ok(
                f"Draft saved: {operation} '{path}' "
                f"(will be applied when you review drafts)"
            )
        except Exception as exc:
            return _error(f"Failed to save draft: {exc}")

    try:
        config = _get_config()
        svc = SpecService(config)
        registry_path = config.get_registry_path()
        entries, links = read_registry(registry_path)

        # Determine if this is an update or create
        existing = next((e for e in entries if e.path == path), None)

        if existing:
            # --- Update ---
            if content:
                # Content provided: write to disk via service
                svc.update_spec(existing.id, content)
                # Re-read registry (update_spec wrote it)
                entries, links = read_registry(registry_path)
                entry = find_entry(entries, existing.id)
            else:
                # Content omitted: registry-sync path — read from disk
                file_path = config.get_project_root() / path
                try:
                    disk_content = read_text(file_path)
                except FileNotFoundError:
                    return _error(
                        f"Cannot sync: file not found at '{path}'. "
                        "Provide 'content' to create the file, or fix the path."
                    )
                # Re-derive title from on-disk content
                entry = find_entry(entries, existing.id)
                if entry:
                    entry.title = _extract_title(disk_content, path)
                    entry.updated = date.today().isoformat()

            # Apply optional metadata (single pass, no extra registry read)
            if entry:
                if "title" in args:
                    entry.title = args["title"]
                if "status" in args:
                    entry.status = args["status"]
                if "covers" in args:
                    entry.covers = args["covers"]
                if "tags" in args:
                    entry.tags = args["tags"]
                write_registry(registry_path, entries, links)

            # Return final state
            detail = svc.get_spec(existing.id)
        else:
            # --- Create ---
            if not content:
                return _error(
                    "Missing 'content' for new spec (required when path is new)"
                )
            spec_type = args.get("type")
            if not spec_type:
                return _error(
                    "Missing 'type' for new spec (required when path is new)"
                )

            spec_id = args.get("id")
            detail = svc.create_spec(spec_type, path, content, spec_id)

            # Apply optional metadata (single registry read after create)
            meta_keys = {"title", "status", "covers", "tags"}
            if meta_keys & args.keys():
                cr_entries, cr_links = read_registry(registry_path)
                entry = find_entry(cr_entries, detail.id)
                if entry:
                    if "title" in args:
                        entry.title = args["title"]
                    if "status" in args:
                        entry.status = args["status"]
                    if "covers" in args:
                        entry.covers = args["covers"]
                    if "tags" in args:
                        entry.tags = args["tags"]
                    write_registry(registry_path, cr_entries, cr_links)

            # Return final state
            detail = svc.get_spec(detail.id)

    except SpecNotFoundError as exc:
        return _error(str(exc))
    except ValueError as exc:
        return _error(f"Validation error: {exc}")
    except Exception as exc:
        return _error(f"Failed to save spec: {exc}")

    # Auto-link spec to meta-ticket if session is attached to one
    _auto_link_spec_to_ticket(detail.id)

    return _json_ok(detail.model_dump(by_alias=True))


@tool(
    "spec_delete",
    "Delete a spec file, its registry entry, and cleanup orphaned links.",
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
            svc = _get_service()
            detail = svc.get_spec(spec_id)
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

    try:
        svc = _get_service()
        svc.delete_spec(spec_id)
    except SpecNotFoundError:
        return _error(f"Spec '{spec_id}' not found")
    except Exception as exc:
        return _error(f"Failed to delete spec: {exc}")

    return _ok(f"Deleted spec '{spec_id}' and cleaned up related links.")


@tool(
    "spec_links",
    "Get links for one or more spec IDs with optional type and direction filters. "
    "Also returns summary info for all referenced nodes.",
    SPEC_LINKS_SCHEMA,
)
async def _spec_links(args: dict) -> dict:
    ids = args.get("ids", [])
    if not ids:
        return _error("Missing required parameter: ids")

    try:
        config = _get_config()
        registry_path = config.get_registry_path()
        entries, links = read_registry(registry_path)
    except Exception as exc:
        return _error(f"Failed to read registry: {exc}")

    # Validate requested IDs exist
    id_set = set(ids)
    entry_ids = {e.id for e in entries}
    missing = id_set - entry_ids
    if missing:
        return _error(f"Unknown spec IDs: {', '.join(sorted(missing))}")

    # Filter links
    link_type = args.get("link_type")
    direction = args.get("direction", "both")

    matched: list[Link] = []
    for lnk in links:
        # Direction filter
        from_match = lnk.from_id in id_set
        to_match = lnk.to_id in id_set
        if direction == "outgoing" and not from_match:
            continue
        if direction == "incoming" and not to_match:
            continue
        if direction == "both" and not (from_match or to_match):
            continue

        # Link type filter
        if link_type and lnk.type != link_type:
            continue

        matched.append(lnk)

    # Collect referenced node IDs
    referenced_ids: set[str] = set()
    for lnk in matched:
        referenced_ids.add(lnk.from_id)
        referenced_ids.add(lnk.to_id)

    nodes = [e for e in entries if e.id in referenced_ids]

    return _json_ok({
        "links": [lnk.model_dump(by_alias=True) for lnk in matched],
        "nodes": [n.model_dump() for n in nodes],
    })


@tool(
    "registry_query",
    "Query registry entries with structured filters. "
    "More efficient than reading the full registry file.",
    REGISTRY_QUERY_SCHEMA,
)
async def _registry_query(args: dict) -> dict:
    try:
        config = _get_config()
        registry_path = config.get_registry_path()
        entries, links = read_registry(registry_path)
    except Exception as exc:
        return _error(f"Failed to read registry: {exc}")

    results = list(entries)

    # Apply filters
    filter_type = args.get("type")
    if filter_type:
        results = [e for e in results if e.type == filter_type]

    filter_status = args.get("status")
    if filter_status:
        results = [e for e in results if e.status == filter_status]

    filter_tag = args.get("tag")
    if filter_tag:
        results = [e for e in results if filter_tag in e.tags]

    filter_covers = args.get("covers")
    if filter_covers:
        results = [
            e for e in results
            if any(c.startswith(filter_covers) or filter_covers.startswith(c) for c in e.covers)
        ]

    filter_ids = args.get("ids")
    if filter_ids:
        id_set = set(filter_ids)
        results = [e for e in results if e.id in id_set]

    response: dict[str, Any] = {"entries": [e.model_dump() for e in results]}

    if args.get("include_links"):
        result_ids = {e.id for e in results}
        related = [
            lnk for lnk in links
            if lnk.from_id in result_ids or lnk.to_id in result_ids
        ]
        response["links"] = [lnk.model_dump(by_alias=True) for lnk in related]

    return _json_ok(response)


@tool(
    "registry_mutate",
    "Batch add, update, and remove registry entries and links atomically. "
    "Validates final state before writing — no partial applies.",
    REGISTRY_MUTATE_SCHEMA,
)
async def _registry_mutate(args: dict) -> dict:
    try:
        config = _get_config()
        registry_path = config.get_registry_path()
        entries, links = read_registry(registry_path)
    except Exception as exc:
        return _error(f"Failed to read registry: {exc}")

    counts = {
        "entries_added": 0,
        "entries_updated": 0,
        "entries_removed": 0,
        "links_added": 0,
        "links_removed": 0,
    }

    today = date.today().isoformat()

    # --- 1. Remove entries (and auto-clean their links) ---
    for entry_id in args.get("remove_entries", []):
        try:
            entries = remove_entry(entries, entry_id)
            links = [
                lnk for lnk in links
                if lnk.from_id != entry_id and lnk.to_id != entry_id
            ]
            counts["entries_removed"] += 1
        except ValueError as exc:
            return _error(f"Cannot remove entry: {exc}")

    # --- 2. Remove explicit links ---
    for lnk_spec in args.get("remove_links", []):
        from_id = lnk_spec.get("from", "")
        to_id = lnk_spec.get("to", "")
        ltype = lnk_spec.get("type", "")
        before = len(links)
        links = [
            lnk for lnk in links
            if not (lnk.from_id == from_id and lnk.to_id == to_id and lnk.type == ltype)
        ]
        if len(links) < before:
            counts["links_removed"] += before - len(links)

    # --- 3. Add entries ---
    for entry_data in args.get("add_entries", []):
        try:
            entry = RegistryEntry(
                id=entry_data["id"],
                type=entry_data["type"],
                path=entry_data["path"],
                title=entry_data["title"],
                status=entry_data.get("status", "draft"),
                covers=entry_data.get("covers", []),
                tags=entry_data.get("tags", []),
                created=today,
                updated=today,
            )
            entries = add_entry(entries, entry)
            counts["entries_added"] += 1
        except (ValueError, KeyError) as exc:
            return _error(f"Cannot add entry: {exc}")

    # --- 4. Add links ---
    new_link_indices: set[int] = set()
    for lnk_data in args.get("add_links", []):
        try:
            lnk = Link(**lnk_data)
            new_link_indices.add(len(links))
            links.append(lnk)
            counts["links_added"] += 1
        except Exception as exc:
            return _error(f"Cannot add link: {exc}")

    # --- 5. Update entries (merge only specified fields) ---
    for update_data in args.get("update_entries", []):
        entry_id = update_data.get("id", "")
        entry = find_entry(entries, entry_id)
        if entry is None:
            return _error(f"Cannot update entry: '{entry_id}' not found")
        if "status" in update_data:
            entry.status = update_data["status"]
        if "title" in update_data:
            entry.title = update_data["title"]
        if "tags" in update_data:
            entry.tags = update_data["tags"]
        if "covers" in update_data:
            entry.covers = update_data["covers"]
        entry.updated = today
        counts["entries_updated"] += 1

    # --- 6. Validate final state ---
    # Structural checks (targets exist, no self-links) apply to ALL links.
    # Type checks only apply to newly-added links — pre-existing links may
    # use types the validator doesn't know about (e.g. "supersedes").
    errors: list[str] = []
    entry_ids = {e.id for e in entries}

    for idx, lnk in enumerate(links):
        if lnk.from_id == lnk.to_id:
            errors.append(f"Self-link: {lnk.from_id}")
        if lnk.from_id not in entry_ids:
            errors.append(f"Link source '{lnk.from_id}' not found")
        if lnk.to_id not in entry_ids:
            errors.append(f"Link target '{lnk.to_id}' not found")
        if idx in new_link_indices and lnk.type not in RECOGNIZED_LINK_TYPES:
            errors.append(f"Unrecognized link type: {lnk.type}")

    # Check for duplicate IDs
    seen: set[str] = set()
    for e in entries:
        if e.id in seen:
            errors.append(f"Duplicate entry ID: {e.id}")
        seen.add(e.id)

    if errors:
        return _error(
            f"Validation failed ({len(errors)} errors), no changes written:\n"
            + "\n".join(f"  - {err}" for err in errors)
        )

    # --- 7. Atomic write ---
    try:
        write_registry(registry_path, entries, links)
    except Exception as exc:
        return _error(f"Failed to write registry: {exc}")

    return _json_ok(counts)


# ---------------------------------------------------------------------------
# MCP server
# ---------------------------------------------------------------------------

specs_mcp_server = create_sdk_mcp_server(
    name="bonsai-specs",
    tools=[
        _spec_list,
        _spec_get,
        _spec_save,
        _spec_delete,
        _spec_links,
        _registry_query,
        _registry_mutate,
    ],
)


async def intercept_specs(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve — validation happens inside the tool handler.

    The handler uses get_tool_context() to access AppConfig.
    """
    return PermissionResultAllow(behavior="allow")


