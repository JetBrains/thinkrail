"""Spec & registry MCP tools — bonsai-specs server.

7 tools giving the Claude agent structured, validated access to the spec
registry and spec files.  All tools are auto-approved; validation errors
are returned as ``isError`` MCP responses, never as permission denials.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from claude_agent_sdk import PermissionResultAllow, create_sdk_mcp_server, tool

from app.agent.models import AgentTask
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
from app.spec.service import SpecNotFoundError, SpecService
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


def _get_config(args: dict) -> AppConfig:
    """Reconstruct AppConfig from the ``_config`` dict injected by the intercept."""
    raw = args.get("_config")
    if raw is None:
        raise RuntimeError("Missing _config in tool args — intercept not wired?")
    return AppConfig(**raw)


def _get_service(args: dict) -> SpecService:
    return SpecService(_get_config(args))


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
    "required": ["path", "content"],
    "properties": {
        "path": {
            "type": "string",
            "description": "Relative path from project root (e.g. 'backend/app/foo/README.md')",
        },
        "content": {
            "type": "string",
            "description": "Full spec file content (Markdown)",
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
        svc = _get_service(args)
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
        svc = _get_service(args)
        detail = svc.get_spec(spec_id)
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
    if not content:
        return _error("Missing required parameter: content")

    try:
        config = _get_config(args)
        svc = SpecService(config)
        registry_path = config.get_registry_path()
        entries, links = read_registry(registry_path)

        # Determine if this is an update or create
        existing = next((e for e in entries if e.path == path), None)

        if existing:
            # --- Update ---
            detail = svc.update_spec(existing.id, content)

            # Apply optional metadata updates
            meta_changed = False
            if "status" in args:
                existing.status = args["status"]
                meta_changed = True
            if "covers" in args:
                existing.covers = args["covers"]
                meta_changed = True
            if "tags" in args:
                existing.tags = args["tags"]
                meta_changed = True
            if meta_changed:
                entries, links = read_registry(registry_path)
                entry = find_entry(entries, existing.id)
                if entry:
                    if "status" in args:
                        entry.status = args["status"]
                    if "covers" in args:
                        entry.covers = args["covers"]
                    if "tags" in args:
                        entry.tags = args["tags"]
                    write_registry(registry_path, entries, links)

            # Re-read to get final state
            detail = svc.get_spec(existing.id)
        else:
            # --- Create ---
            spec_type = args.get("type")
            if not spec_type:
                return _error("Missing 'type' for new spec (required when path is new)")

            spec_id = args.get("id")
            detail = svc.create_spec(spec_type, path, content, spec_id)

            # Apply optional metadata
            meta_changed = False
            re_entries, re_links = read_registry(registry_path)
            entry = find_entry(re_entries, detail.id)
            if entry:
                if "status" in args:
                    entry.status = args["status"]
                    meta_changed = True
                if "covers" in args:
                    entry.covers = args["covers"]
                    meta_changed = True
                if "tags" in args:
                    entry.tags = args["tags"]
                    meta_changed = True
                if meta_changed:
                    write_registry(registry_path, re_entries, re_links)

            # Re-read to get final state
            detail = svc.get_spec(detail.id)

    except SpecNotFoundError as exc:
        return _error(str(exc))
    except ValueError as exc:
        return _error(f"Validation error: {exc}")
    except Exception as exc:
        return _error(f"Failed to save spec: {exc}")

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
    try:
        svc = _get_service(args)
        svc.delete_spec(spec_id)
    except SpecNotFoundError:
        return _error(f"Spec '{spec_id}' not found")
    except Exception as exc:
        return _error(f"Failed to delete spec: {exc}")

    return _ok(f"✓ Deleted spec '{spec_id}' and cleaned up related links.")


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
        config = _get_config(args)
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
        config = _get_config(args)
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
        config = _get_config(args)
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
    for lnk_data in args.get("add_links", []):
        try:
            lnk = Link(**lnk_data)
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
    errors: list[str] = []
    entry_ids = {e.id for e in entries}

    for lnk in links:
        if lnk.from_id == lnk.to_id:
            errors.append(f"Self-link: {lnk.from_id}")
        if lnk.from_id not in entry_ids:
            errors.append(f"Link source '{lnk.from_id}' not found")
        if lnk.to_id not in entry_ids:
            errors.append(f"Link target '{lnk.to_id}' not found")
        if lnk.type not in RECOGNIZED_LINK_TYPES:
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


# ---------------------------------------------------------------------------
# Interceptor
# ---------------------------------------------------------------------------


async def intercept_specs(
    input_data: dict[str, Any],
    tracker: Tracker,
    notify: Any,
    task: AgentTask,
    config: AppConfig,
) -> PermissionResultAllow:
    """Auto-approve all spec tools; inject config for handler use."""
    return PermissionResultAllow(
        behavior="allow",
        updated_input={**input_data, "_config": config.model_dump(mode="json")},
    )
