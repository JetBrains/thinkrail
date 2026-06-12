"""Spec amendment helpers.

Provides the primitives used by the ``ProposeChange`` MCP tool to amend
spec files in place: substitute text, validate the result, log the diff to
the per-ticket ``history.patch`` session log, and surface the spec id
for ticket auto-linking.
"""
from __future__ import annotations

import difflib
import logging
import re
from datetime import UTC, datetime
from pathlib import Path

from app.board.artifact_paths import artifact_path
from app.spec.frontmatter import FrontmatterError, parse_frontmatter

logger = logging.getLogger(__name__)


class AmendmentError(Exception):
    """Raised by :func:`apply_amendment` when args don't match the file."""


# ── apply ───────────────────────────────────────────────────────


def apply_amendment(
    *,
    project_root: Path,
    file_path: str,
    old_string: str,
    new_string: str,
) -> str:
    """Replace ``old_string`` with ``new_string`` in ``file_path`` under ``project_root``.

    Returns the post-amendment file content. Raises :class:`AmendmentError`
    if ``old_string`` is missing or not unique, or if ``file_path`` escapes
    the project root.
    """
    root = project_root.resolve()
    abs_path = (project_root / file_path).resolve()
    try:
        abs_path.relative_to(root)
    except ValueError:
        raise AmendmentError(f"file_path '{file_path}' is outside project root")
    if not abs_path.is_file():
        raise AmendmentError(f"file '{file_path}' does not exist")

    content = abs_path.read_text(encoding="utf-8")
    occurrences = content.count(old_string)
    if occurrences == 0:
        raise AmendmentError(f"old_string not found in '{file_path}'")
    if occurrences > 1:
        raise AmendmentError(
            f"old_string not unique in '{file_path}' "
            f"({occurrences} occurrences) — include more surrounding context"
        )
    new_content = content.replace(old_string, new_string, 1)
    abs_path.write_text(new_content, encoding="utf-8")
    return new_content


# ── validate ────────────────────────────────────────────────────


_MD_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)#]+)\)")


def validate_amended_file(project_root: Path, file_path: str) -> list[dict]:
    """Check the file for frontmatter + link integrity issues.

    Returns a list of warning dicts; empty list means clean. Never raises;
    treats reads of missing files as 'cannot validate' (empty result).
    """
    abs_path = (project_root / file_path).resolve()
    if not abs_path.is_file():
        return []
    warnings: list[dict] = []
    content = abs_path.read_text(encoding="utf-8")

    if content.startswith("---\n"):
        try:
            parse_frontmatter(content)
        except FrontmatterError as exc:
            warnings.append({"kind": "frontmatter", "message": str(exc)})

    for match in _MD_LINK_RE.finditer(content):
        target = match.group(1).strip()
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        if target.startswith("/"):
            target_path = (project_root / target.lstrip("/")).resolve()
        else:
            target_path = (abs_path.parent / target).resolve()
        if not target_path.exists():
            warnings.append({
                "kind": "link",
                "message": f"broken link to {target} (resolved {target_path})",
            })
    return warnings


# ── append to .patch log ────────────────────────────────────────


def _build_metadata_header(
    n: int,
    *,
    skill: str | None,
    spec_id: str | None,
    section: str | None,
    rationale: str | None,
    applied_as: str,
    validation: str,
    timestamp: str,
) -> str:
    lines = [
        f"# == amendment {n} =================================",
        f"# skill:      {_escape_meta(skill or '-')}",
        f"# spec_id:    {_escape_meta(spec_id or '(none)')}",
        f"# section:    {_escape_meta(section or '(none)')}",
        f"# rationale:  {_escape_meta(rationale or '(none)')}",
        f"# applied_as: {_escape_meta(applied_as)}",
        f"# validation: {_escape_meta(validation)}",
        f"# timestamp:  {_escape_meta(timestamp)}",
        "",
    ]
    return "\n".join(lines)


def _escape_meta(value: str) -> str:
    """Escape characters that would corrupt the meta block on parse.

    Newlines become literal ``\\n``/``\\r`` so a multi-line value stays on
    a single ``# key: value`` line.
    """
    return value.replace("\\", "\\\\").replace("\r", "\\r").replace("\n", "\\n")


def _unescape_meta(value: str) -> str:
    out = []
    i = 0
    while i < len(value):
        if value[i] == "\\" and i + 1 < len(value):
            nxt = value[i + 1]
            if nxt == "n":
                out.append("\n"); i += 2; continue
            if nxt == "r":
                out.append("\r"); i += 2; continue
            if nxt == "\\":
                out.append("\\"); i += 2; continue
        out.append(value[i])
        i += 1
    return "".join(out)


def _next_amendment_number(log_text: str) -> int:
    return log_text.count("# == amendment ") + 1


def append_amendment(
    *,
    project_root: Path,
    ticket_id: str,
    file_path: str,
    old_content: str,
    new_content: str,
    spec_id: str | None,
    section: str | None,
    rationale: str | None,
    applied_as: str,
    validation: str,
    skill: str | None = None,
    timestamp: str | None = None,
) -> Path:
    """Append a metadata header + unified-diff hunk to the ticket's .patch log."""
    ts = timestamp or datetime.now(UTC).isoformat()
    log_path = artifact_path(project_root, ticket_id, "history")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    existing = log_path.read_text(encoding="utf-8") if log_path.is_file() else ""
    n = _next_amendment_number(existing)

    header = _build_metadata_header(
        n,
        skill=skill,
        spec_id=spec_id, section=section, rationale=rationale,
        applied_as=applied_as, validation=validation, timestamp=ts,
    )
    diff_lines = list(difflib.unified_diff(
        old_content.splitlines(keepends=True),
        new_content.splitlines(keepends=True),
        fromfile=f"a/{file_path}",
        tofile=f"b/{file_path}",
    ))
    diff = "".join(diff_lines)

    separator = "" if not existing else "\n\n"
    log_path.write_text(existing + separator + header + "\n" + diff, encoding="utf-8")
    return log_path


# ── parse .patch log ────────────────────────────────────────────


_ENTRY_SPLIT_RE = re.compile(r"^# == amendment (\d+) =+\s*$", re.MULTILINE)
_META_RE = re.compile(r"^# (\w+):\s*(.*?)\s*$", re.MULTILINE)
_DIFF_FILE_RE = re.compile(r"^--- a/(.+?)$", re.MULTILINE)


def parse_patch_log(project_root: Path, ticket_id: str) -> list[dict]:
    """Parse the per-ticket history.patch into structured entries.

    Returns a list of dicts with keys: ``index``, ``skill`` (None for legacy
    entries), ``filePath``, ``specId``, ``section``, ``rationale``,
    ``appliedAs``, ``validation``, ``timestamp``, ``diff``.

    Missing on-disk file → empty list.
    """
    log_path = artifact_path(project_root, ticket_id, "history")
    if not log_path.is_file():
        return []
    text = log_path.read_text(encoding="utf-8")

    # Split on the separator. The first chunk before any separator is junk.
    matches = list(_ENTRY_SPLIT_RE.finditer(text))
    entries: list[dict] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end]
        # Trim trailing blank separator between entries.
        body = body.rstrip("\n")

        # Pull metadata lines from the start; everything else is the diff.
        #
        # `body` begins with the newline that follows the entry header line,
        # so split("\n") yields an empty leading element. We must NOT treat
        # that leading blank as end-of-meta — only a blank line AFTER at
        # least one meta line terminates the block.
        meta: dict[str, str] = {}
        diff_lines: list[str] = []
        in_meta = True
        for line in body.split("\n"):
            if in_meta and line.startswith("#"):
                mm = _META_RE.match(line)
                if mm:
                    meta[mm.group(1)] = _unescape_meta(mm.group(2))
                continue
            if in_meta and not line.strip():
                if meta:
                    in_meta = False
                continue
            in_meta = False
            diff_lines.append(line)
        diff = "\n".join(diff_lines).strip("\n")

        # Parse file path from the diff's `--- a/<path>` line.
        file_match = _DIFF_FILE_RE.search(diff)
        file_path = file_match.group(1) if file_match else ""

        def _empty_to_none(value: str) -> str | None:
            if value in ("", "(none)", "-"):
                return None
            return value

        entries.append({
            "index": int(m.group(1)),
            "skill": _empty_to_none(meta.get("skill", "")),
            "filePath": file_path,
            "specId": _empty_to_none(meta.get("spec_id", "")),
            "section": _empty_to_none(meta.get("section", "")),
            "rationale": _empty_to_none(meta.get("rationale", "")),
            "appliedAs": meta.get("applied_as", "original"),
            "validation": meta.get("validation", "ok"),
            "timestamp": meta.get("timestamp", ""),
            "diff": diff,
        })
    return entries


# ── spec-id for auto-link ───────────────────────────────────────


def extract_spec_id_for_link(project_root: Path, file_path: str) -> str | None:
    """Return the spec's ``id:`` frontmatter field, or ``None`` if absent / unparseable."""
    abs_path = (project_root / file_path).resolve()
    if not abs_path.is_file():
        return None
    content = abs_path.read_text(encoding="utf-8")
    if not content.startswith("---\n"):
        return None
    try:
        frontmatter, _body = parse_frontmatter(content)
    except FrontmatterError:
        return None
    spec_id = frontmatter.get("id")
    return str(spec_id) if spec_id else None
