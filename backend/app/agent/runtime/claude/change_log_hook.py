"""PostToolUse hook that records ticket-session file changes to history.patch.

Replaces the logging/validation/auto-link half of the retired ProposeChange
tool. Fires after every successful Edit/Write/MultiEdit, in every permission
mode. The recorded diff is built straight from the tool's own change data
(old_string/new_string/content) — no file read, no reversal. Auto-link and
artifact bookkeeping run only for .tr spec/artifact files.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.board.artifact_paths import resolve_ticket_artifact
from app.board.patch import (
    append_amendment,
    build_change_diff,
    extract_spec_id_for_link,
    validate_amended_file,
)
from app.board.service import BoardService, TicketNotFoundError
from app.core.config import DESIGN_DOCS_DIR, PROJECT_DIRNAME

if TYPE_CHECKING:
    from app.agent.models import AgentTask
    from app.core.config import AppConfig

logger = logging.getLogger(__name__)

_TRACKED_TOOLS = ("Edit", "MultiEdit", "Write")


def _extract_changes(tool_name: str, tool_input: dict) -> list[tuple[str, str]] | None:
    if tool_name == "Edit":
        return [(tool_input.get("old_string", ""), tool_input.get("new_string", ""))]
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits") or []
        return [(e.get("old_string", ""), e.get("new_string", "")) for e in edits]
    if tool_name == "Write":
        return [("", tool_input.get("content", ""))]
    return None


class ChangeLogHook:
    """Per-session PostToolUse hook. Constructed once per ``run_session``."""

    def __init__(self, task: AgentTask, config: AppConfig) -> None:
        self.task = task
        self.config = config

    async def post_tool_use(
        self, hook_input: Any, tool_use_id: str | None, context: Any
    ) -> dict[str, Any]:
        try:
            task = self.task
            if not task.ticket_id:
                return {}
            tool_name = hook_input.get("tool_name", "")
            if tool_name not in _TRACKED_TOOLS:
                return {}
            tool_input = hook_input.get("tool_input") or {}
            project_root = self.config.get_project_root()
            rel = self._project_relative(project_root, tool_input.get("file_path", ""))
            if rel is None:
                return {}

            changes = _extract_changes(tool_name, tool_input)
            if not changes:
                return {}
            diff = build_change_diff(rel, changes)
            if not diff.strip():
                return {}

            artifact = resolve_ticket_artifact(project_root, rel)
            is_spec = artifact is not None or self._under_design_docs(rel)
            validation = "ok"
            spec_id = None
            if is_spec:
                warnings = validate_amended_file(project_root, rel)
                validation = "ok" if not warnings else "warnings"
                spec_id = extract_spec_id_for_link(project_root, rel)

            append_amendment(
                project_root=project_root,
                ticket_id=task.ticket_id,
                file_path=rel,
                diff=diff,
                spec_id=spec_id,
                section=None,
                rationale=None,
                applied_as="original",
                validation=validation,
                skill=task.skill_id,
            )

            # Artifact tracking + the ui/artifactAdded event for Edit/Write is
            # already emitted by AgentService at agent/toolCallStart; this hook
            # only owns the history.patch log, spec auto-link, and bookkeeping.
            svc = BoardService(self.config)
            if spec_id:
                try:
                    svc.link_spec(task.ticket_id, spec_id)
                except TicketNotFoundError:
                    logger.debug("ticket %s gone before auto-link", task.ticket_id)
            if artifact is not None:
                svc.sync_artifact_bookkeeping(artifact[0], artifact[1])
        except Exception:
            logger.debug("change-log hook failed", exc_info=True)
        return {}

    @staticmethod
    def _project_relative(project_root: Any, file_path: str) -> str | None:
        if not file_path:
            return None
        try:
            abs_path = (project_root / file_path).resolve()
            return abs_path.relative_to(project_root.resolve()).as_posix()
        except (ValueError, OSError):
            return None

    @staticmethod
    def _under_design_docs(rel: str) -> bool:
        return rel.startswith(f"{PROJECT_DIRNAME}/{DESIGN_DOCS_DIR}/")
