from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
from pathlib import Path
import threading
import time

from app.board.artifact_paths import (
    ARTIFACT_FILENAMES,
    LEGACY_HISTORY_FILENAME,
    ensure_ticket_dir,
)
from app.board.models import ArtifactKind, Ticket
from app.core.config import PROJECT_DIRNAME, TICKETS_DIR
from app.core.fileio import ensure_dir, read_text

logger = logging.getLogger(__name__)

_TICKET_META_FILENAME = "ticket.json"


def tickets_root(project_root: Path) -> Path:
    return project_root / PROJECT_DIRNAME / TICKETS_DIR


def ticket_path(base_dir: Path, ticket_id: str) -> Path:
    """Return the file path for a ticket JSON file inside its per-ticket folder.

    ``base_dir`` is expected to be ``{project_root}/.tr/tickets/`` (i.e.,
    ``tickets_root(project_root)``).
    """
    return base_dir / ticket_id / _TICKET_META_FILENAME


def read_ticket(path: Path) -> Ticket:
    """Read a single meta-ticket from a JSON file.

    After parsing, reconcile derivable bookkeeping fields with disk truth:
    artifact ``*_path`` fields and (for ``product_design``) an empty body
    auto-fill from the markdown's first paragraph. Reconciled state is
    written back so subsequent reads are no-ops.
    """
    content = read_text(path)
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Malformed ticket JSON at {path}: {exc}") from exc
    # Drop legacy fields no longer present on Ticket.
    for legacy in (
        "specChanges", "specPatches", "ticketDir",
        "designDocPath", "planPath",
        "designDocStale", "planStale",
    ):
        data.pop(legacy, None)
    ticket = Ticket(**data)
    if _reconcile_with_disk(ticket, path.parent):
        write_ticket(path, ticket)
    return ticket


# ── Disk-truth reconciliation ───────────────────────────────────


_PATH_FIELD: dict[ArtifactKind, str] = {
    "product_design": "product_design_path",
    "technical_design": "technical_design_path",
    "history": "history_path",
    "implementation_plan": "implementation_plan_path",
}


def _reconcile_with_disk(ticket: Ticket, ticket_folder: Path) -> bool:
    """Sync ``*_path`` fields and the body auto-fallback with disk truth.

    Returns ``True`` if any field was updated. Idempotent: a fully-reconciled
    ticket returns ``False`` and no state changes.

    This makes bookkeeping self-healing — agents that write artifacts via
    ``Write`` (bypassing :meth:`BoardService.write_artifact`) still get
    their changes reflected on the next ticket read.
    """
    changed = False
    # Legacy migration: the per-ticket history log used to be called
    # spec-diff.patch. If only the legacy file exists, rename it on disk
    # so the rest of the reconcile loop sees the canonical name.
    legacy = ticket_folder / LEGACY_HISTORY_FILENAME
    new_history = ticket_folder / ARTIFACT_FILENAMES["history"]
    if legacy.exists() and not new_history.exists():
        try:
            legacy.rename(new_history)
            changed = True
        except OSError as e:
            logger.warning("Failed to migrate %s → %s: %s", legacy, new_history, e)
    for kind, filename in ARTIFACT_FILENAMES.items():
        file_path = ticket_folder / filename
        attr = _PATH_FIELD[kind]
        if file_path.exists():
            expected = f"{PROJECT_DIRNAME}/{TICKETS_DIR}/{ticket.id}/{filename}"
            if getattr(ticket, attr) != expected:
                setattr(ticket, attr, expected)
                changed = True
        else:
            if getattr(ticket, attr) is not None:
                setattr(ticket, attr, None)
                changed = True

    # Auto-fallback body from product-design.md when body is empty.
    pd = ticket_folder / ARTIFACT_FILENAMES["product_design"]
    if not ticket.body and pd.exists():
        try:
            content = pd.read_text(encoding="utf-8")
        except OSError:
            content = ""
        fallback = _extract_first_paragraph(content)
        if fallback and ticket.body != fallback:
            ticket.body = fallback
            changed = True

    return changed


def _extract_first_paragraph(markdown: str) -> str:
    """Strip YAML frontmatter then return the first non-empty paragraph.

    A paragraph ends at the next blank line. The leading ``# Title`` line, if
    present, is skipped — descriptions should describe the work, not echo
    the title.
    """
    text = markdown
    if text.startswith("---"):
        end = text.find("\n---\n", 4)
        if end != -1:
            text = text[end + len("\n---\n"):]
    lines = text.lstrip().splitlines()
    while lines and lines[0].startswith("#"):
        lines.pop(0)
        while lines and not lines[0].strip():
            lines.pop(0)
    paragraph: list[str] = []
    for line in lines:
        if not line.strip():
            if paragraph:
                break
            continue
        paragraph.append(line.rstrip())
    return "\n".join(paragraph).strip()


def write_ticket(path: Path, ticket: Ticket) -> None:
    """Write a meta-ticket to a JSON file atomically (temp → rename)."""
    data = ticket.model_dump(by_alias=True)
    content = json.dumps(data, indent=2) + "\n"

    dir_ = path.parent
    ensure_dir(dir_)
    fd, tmp = tempfile.mkstemp(dir=dir_, suffix=".tmp")
    os.close(fd)
    tmp_path = Path(tmp)
    try:
        tmp_path.write_text(content, encoding="utf-8")
        tmp_path.replace(path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def list_tickets(base_dir: Path) -> list[Ticket]:
    """Walk ``base_dir`` looking for ``{ticket_id}/ticket.json`` and read each one.

    Returns an empty list if ``base_dir`` does not exist. Folders without a
    ``ticket.json`` (e.g., orphan artifact folders from prior layouts) are
    silently skipped. Malformed JSON files are skipped.
    """
    if not base_dir.is_dir():
        return []
    tickets: list[Ticket] = []
    for entry in sorted(base_dir.iterdir()):
        if not entry.is_dir():
            continue
        meta = entry / _TICKET_META_FILENAME
        if not meta.is_file():
            continue
        try:
            tickets.append(read_ticket(meta))
        except (ValueError, FileNotFoundError) as exc:
            logger.debug("Skipping malformed ticket at %s: %s", meta, exc)
            continue
        except Exception as exc:  # noqa: BLE001 - Pydantic validation errors
            logger.debug("Skipping invalid ticket at %s: %s", meta, exc)
            continue
    return tickets


def delete_ticket(path: Path) -> None:
    folder = path.parent

    def delayed_delete():
        time.sleep(1)

        try:
            if folder.exists():
                shutil.rmtree(folder)
        except Exception:
            pass

    threading.Thread(target=delayed_delete, daemon=True).start()


# ── Legacy-layout cleanup ────────────────────────────────────────


def wipe_legacy_meta_tickets(project_root: Path) -> bool:
    """If ``.tr/meta-tickets/`` is present and empty, remove it.

    When the folder still has content, leaves it in place and logs a warning
    — the new schema lives under ``.tr/tickets/`` and the user is
    expected to move or discard any meta-tickets data themselves.
    """
    legacy = project_root / PROJECT_DIRNAME / "meta-tickets"
    if not legacy.is_dir():
        return False
    try:
        has_content = any(legacy.iterdir())
    except OSError:
        return False
    if has_content:
        logger.warning(
            "legacy %s contains files from the previous schema; leaving it in "
            "place. Move or delete it manually to silence this warning.",
            legacy,
        )
        return False
    try:
        legacy.rmdir()
    except OSError:
        return False
    return True


def ensure_ticket_folder(project_root: Path, ticket_id: str) -> Path:
    """Convenience wrapper: ensure ``.tr/tickets/{id}/`` exists; return the folder."""
    return ensure_ticket_dir(project_root, ticket_id)
