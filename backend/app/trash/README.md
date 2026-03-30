# Trash Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-30

## Purpose

The Trash module provides soft-delete for sessions and tickets. Instead of permanently removing files, it moves them to `.bonsai/trash/{type}/{id}/` with a `_trash.json` sidecar that records the original location and timestamp. Items can be restored or permanently purged.

## Internal Architecture

**Pattern:** Stateless service + storage layer

`service.py` is the facade providing type-specific trash/restore methods. `storage.py` handles low-level file moves.

### Storage Layout

```
.bonsai/trash/
  sessions/{bonsai_sid}/
    {bonsai_sid}.json
    {bonsai_sid}.events.jsonl
    _trash.json
  tickets/{ticket_id}/
    {ticket_id}.json
    _trash.json
```

The `_trash.json` sidecar:
```json
{ "trashedAt": "ISO8601", "originalDir": "/path/to/original/directory" }
```

## File Organization

| File | Responsibility |
|------|---------------|
| `service.py` | `TrashService` — trash/restore/list/purge/empty for sessions and tickets |
| `storage.py` | Low-level: `move_to_trash`, `restore_from_trash`, `list_trashed`, `purge_trashed` |

## Public Interface

### TrashService

| Method | Description |
|--------|-------------|
| `trash_session(bonsai_sid)` | Move session files to trash |
| `restore_session(bonsai_sid)` | Restore session from trash |
| `trash_ticket(ticket_id)` | Move ticket file to trash |
| `restore_ticket(ticket_id)` | Restore ticket from trash |
| `list_trashed(item_type?)` | List trashed items, optionally by type |
| `purge(type, id)` | Permanently delete a trashed item |
| `empty_trash(item_type?)` | Purge all trashed items |

## Dependencies

- No external dependencies — pure filesystem operations using `shutil` and `json`

## Design Decisions

- **File move, not copy:** Uses `shutil.move` for atomicity. No partial state on failure.
- **Sidecar pattern:** `_trash.json` stores restore metadata alongside the trashed files, making the trash self-documenting.
- **No auto-purge:** Trashed items persist indefinitely. Manual purge via RPC.
- **Silent skip on missing:** `trash_session`/`trash_ticket` silently skip if source files don't exist (already deleted or never created).

## Known Limitations

- No UI for trash management yet — backend-only with RPC endpoints
- Restore does not re-attach sessions to tickets automatically
- No auto-cleanup of old trashed items
