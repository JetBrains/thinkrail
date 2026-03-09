from __future__ import annotations

import datetime
import glob
import json
import logging
import os
import re
import time
from collections.abc import Callable, Awaitable
from pathlib import Path
from typing import Any

from app.viz.models import (
    CoverageEntry,
    DashboardState,
    LintIssue,
    Recommendation,
    TaskEntry,
    WorkflowStep,
)

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

REQUIRED_SECTIONS: dict[str, list[str]] = {
    "architecture-design": [
        "Table of Contents", "High-Level Pipeline", "Source Tree",
        "Data Flow", "Key Design Decisions",
    ],
    "module-design": [
        "Table of Contents", "Public Interface", "Output Contract",
        "Key Design Decisions", "Known Limitations",
    ],
    "task-spec": ["Context", "Files", "Definition of Done"],
    "goal-and-requirements": ["Goal", "Business Requirements", "Technical Requirements"],
}

CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".c", ".cpp",
    ".java", ".rb", ".swift", ".kt",
}

IGNORE_DIRS = {
    "node_modules", ".venv", "__pycache__", "dist", ".git", ".specs",
    "vendor", ".idea", ".vscode", "current_tasks", ".claude", "claude-plugin",
}

STATUS_RE = re.compile(r"\*\*Status:\*\*\s*(\S+)", re.IGNORECASE)
HEADING_RE = re.compile(r"^##\s+(.+)", re.MULTILINE)

WORKFLOW_STEPS = [
    WorkflowStep("goal-and-requirements", "Goal & Requirements", "pending", "GOAL&REQUIREMENTS.md"),
    WorkflowStep("architecture-design",   "Architecture Design",  "pending", "DESIGN_DOC.md"),
    WorkflowStep("module-specs",          "Module Specs",         "pending"),
    WorkflowStep("task-specs",            "Task Specs",           "pending"),
    WorkflowStep("implementation",        "Implementation",       "pending"),
]

SPEC_TYPE_TO_WORKFLOW: dict[str, str] = {
    "goal-and-requirements": "goal-and-requirements",
    "architecture-design": "architecture-design",
    "module-design": "module-specs",
    "submodule-design": "module-specs",
    "task-spec": "task-specs",
}

NotifyFn = Callable[[str, dict], Awaitable[None]]


# ── VisualizationService ──────────────────────────────────────────────────────

class VisualizationService:
    """Maintains live dashboard state for the Bonsai web UI."""

    def __init__(self, project_root: Path) -> None:
        self._root = project_root
        self._state = DashboardState()
        self._notify: NotifyFn | None = None

    def bind_notify(self, notify: NotifyFn) -> None:
        self._notify = notify

    def get_state(self) -> DashboardState:
        return self._state

    def refresh(self) -> None:
        """Recompute state synchronously without pushing a notification."""
        try:
            self._state = self._compute()
        except Exception:
            logger.exception("VisualizationService: refresh failed")

    async def recompute(self) -> DashboardState:
        """Recompute dashboard from registry, files, tasks. Push update if bound."""
        try:
            self._state = self._compute()
        except Exception:
            logger.exception("VisualizationService: recompute failed")
            return self._state
        if self._notify:
            try:
                await self._notify("viz/stateChanged", self._state.to_dict())
            except Exception:
                logger.debug("viz/stateChanged notify failed (WS disconnected?)")
        return self._state

    # ── Computation ──────────────────────────────────────────────────────────

    def _compute(self) -> DashboardState:
        start = time.monotonic()
        registry = self._read_registry()
        specs = registry.get("specs", [])

        # Coverage
        source_dirs = self._find_source_dirs()
        coverage_list = self._compute_coverage(registry, source_dirs)
        freshness = self._compute_freshness(registry)

        covered = sum(1 for c in coverage_list if c.spec_id)
        total_dirs = len(coverage_list)
        coverage_pct = round(covered * 100 / total_dirs) if total_dirs else 100

        # Specs counts
        spec_count = len(specs)
        active_count = sum(1 for s in specs if s.get("status") == "active")
        stale_ids = {sid for sid, f in freshness.items() if f == "stale"}
        stale_count = len(stale_ids)

        # Tasks
        tasks = self._parse_tasks()
        task_count = len(tasks)
        tasks_done = sum(1 for t in tasks if t.status.lower() == "done")
        tasks_pending = task_count - tasks_done

        # Lint
        lint_issues = self._run_lint(registry)
        lint_errors = sum(1 for i in lint_issues if i.severity == "error")
        lint_warnings = sum(1 for i in lint_issues if i.severity == "warning")

        # Workflow steps
        done_types: set[str] = set()
        for spec in specs:
            if spec.get("status") == "done":
                wf_step = SPEC_TYPE_TO_WORKFLOW.get(spec.get("type", ""))
                if wf_step:
                    done_types.add(wf_step)
        steps = self._compute_workflow_steps(done_types, tasks_done, task_count)
        current_phase = next(
            (s.id for s in steps if s.status == "in_progress"),
            next((s.id for s in steps if s.status == "pending"), "implementation"),
        )

        # Recommendations
        recommendations = self._make_recommendations(
            coverage_pct, stale_count, lint_errors, lint_warnings,
            tasks_pending, current_phase,
        )

        elapsed_ms = round((time.monotonic() - start) * 1000)
        one_liner = (
            f"{coverage_pct}% coverage | {tasks_done}/{task_count} tasks done"
            f" | {stale_count} stale | {lint_errors} lint error(s)"
        )

        return DashboardState(
            coverage_pct=coverage_pct,
            spec_count=spec_count,
            active_count=active_count,
            stale_count=stale_count,
            task_count=task_count,
            tasks_done=tasks_done,
            tasks_pending=tasks_pending,
            lint_errors=lint_errors,
            lint_warnings=lint_warnings,
            workflow_phase=current_phase,
            workflow_steps=steps,
            coverage=coverage_list,
            pending_tasks=[t for t in tasks if t.status.lower() != "done"],
            lint_issues=lint_issues,
            recommendations=recommendations,
            computed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            one_liner=one_liner,
        )

    def _read_registry(self) -> dict[str, Any]:
        registry_path = self._root / ".specs" / "registry.json"
        try:
            return json.loads(registry_path.read_text())
        except Exception:
            return {"specs": [], "links": []}

    def _find_source_dirs(self) -> list[str]:
        dirs: set[str] = set()
        for dirpath, dirnames, filenames in os.walk(self._root):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            rel = os.path.relpath(dirpath, self._root)
            if rel == ".":
                continue
            for f in filenames:
                if os.path.splitext(f)[1] in CODE_EXTENSIONS:
                    dirs.add(rel + "/")
                    break
        return sorted(dirs)

    def _compute_coverage(
        self, registry: dict[str, Any], source_dirs: list[str]
    ) -> list[CoverageEntry]:
        specs = registry.get("specs", [])
        result = []
        for src_dir in source_dirs:
            matching = None
            for spec in specs:
                for cover in spec.get("covers", []):
                    if src_dir.startswith(cover) or cover.startswith(src_dir):
                        matching = spec
                        break
                if matching:
                    break
            result.append(CoverageEntry(
                path=src_dir,
                spec_id=matching["id"] if matching else None,
                spec_path=matching["path"] if matching else None,
                freshness="uncovered",  # will be overridden below
            ))
        # Annotate freshness from freshness map
        freshness = self._compute_freshness(registry)
        for entry in result:
            if entry.spec_id and entry.spec_id in freshness:
                entry.freshness = freshness[entry.spec_id]
        return result

    def _compute_freshness(self, registry: dict[str, Any]) -> dict[str, str]:
        results: dict[str, str] = {}
        for spec in registry.get("specs", []):
            covers = spec.get("covers", [])
            if not covers:
                results[spec["id"]] = "n/a"
                continue
            spec_path = self._root / spec["path"]
            try:
                spec_mt = spec_path.stat().st_mtime
            except OSError:
                results[spec["id"]] = "n/a"
                continue
            code_mt = max(
                (self._max_code_mtime(cover) for cover in covers),
                default=0,
            )
            if code_mt == 0:
                results[spec["id"]] = "n/a"
            elif spec_mt >= code_mt:
                results[spec["id"]] = "fresh"
            else:
                results[spec["id"]] = "stale"
        return results

    def _max_code_mtime(self, cover_path: str) -> float:
        abs_cover = self._root / cover_path
        best = 0.0
        if abs_cover.is_file():
            return abs_cover.stat().st_mtime
        if not abs_cover.is_dir():
            return 0.0
        for dirpath, dirnames, filenames in os.walk(abs_cover):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            for f in filenames:
                if os.path.splitext(f)[1] in CODE_EXTENSIONS:
                    try:
                        t = os.path.getmtime(os.path.join(dirpath, f))
                        if t > best:
                            best = t
                    except OSError:
                        pass
        return best

    def _run_lint(self, registry: dict[str, Any]) -> list[LintIssue]:
        issues: list[LintIssue] = []
        for spec in registry.get("specs", []):
            spec_type = spec.get("type", "")
            required = REQUIRED_SECTIONS.get(spec_type)
            if not required:
                continue
            spec_path = self._root / spec["path"]
            try:
                content = spec_path.read_text(encoding="utf-8")[:4096]
            except OSError:
                issues.append(LintIssue(
                    spec_id=spec["id"], path=spec["path"],
                    severity="error", category="missing-file",
                    message=f"Spec file not found: {spec['path']}", fixable=False,
                ))
                continue
            headings = set(HEADING_RE.findall(content))
            for section in required:
                if not any(section.lower() in h.lower() for h in headings):
                    issues.append(LintIssue(
                        spec_id=spec["id"], path=spec["path"],
                        severity="warning", category="structure",
                        message=f"Missing section: {section}", fixable=False,
                    ))
        # Check broken links
        spec_ids = {s["id"] for s in registry.get("specs", [])}
        for link in registry.get("links", []):
            if link.get("from") not in spec_ids:
                issues.append(LintIssue(
                    spec_id=None, path="", severity="error",
                    category="broken-link",
                    message=f"Link from '{link['from']}' references non-existent spec",
                    fixable=True,
                ))
            if link.get("to") not in spec_ids:
                issues.append(LintIssue(
                    spec_id=None, path="", severity="error",
                    category="broken-link",
                    message=f"Link to '{link['to']}' references non-existent spec",
                    fixable=True,
                ))
        return issues

    def _parse_tasks(self) -> list[TaskEntry]:
        tasks: list[TaskEntry] = []
        task_dir = self._root / "current_tasks"
        if not task_dir.is_dir():
            return tasks
        pattern = str(task_dir / "**" / "*.md")
        for fpath in sorted(glob.glob(pattern, recursive=True)):
            rel = os.path.relpath(fpath, self._root)
            parts = rel.replace("current_tasks" + os.sep, "").split(os.sep)
            module = parts[0] if len(parts) > 1 else "general"
            basename = os.path.splitext(os.path.basename(fpath))[0]
            try:
                content = Path(fpath).read_text(encoding="utf-8")[:500]
            except OSError:
                continue
            match = STATUS_RE.search(content)
            raw = match.group(1).rstrip(".") if match else "Unknown"
            status_map = {"done": "Done", "in progress": "In Progress", "pending": "Pending"}
            status = status_map.get(raw.lower(), raw)
            tasks.append(TaskEntry(id=basename, path=rel, module=module, status=status))
        return tasks

    def _compute_workflow_steps(
        self, done_types: set[str], tasks_done: int, task_count: int
    ) -> list[WorkflowStep]:
        steps = []
        found_current = False
        for template in WORKFLOW_STEPS:
            if template.id == "implementation":
                all_tasks_done = task_count > 0 and tasks_done == task_count
                status = "completed" if all_tasks_done else ("in_progress" if not found_current else "pending")
            elif template.id in done_types:
                status = "completed"
            else:
                status = "in_progress" if not found_current else "pending"

            if status == "in_progress":
                found_current = True

            steps.append(WorkflowStep(
                id=template.id,
                label=template.label,
                status=status,
                file=template.file,
            ))
        return steps

    def _make_recommendations(
        self,
        coverage_pct: int,
        stale_count: int,
        lint_errors: int,
        lint_warnings: int,
        tasks_pending: int,
        phase: str,
    ) -> list[Recommendation]:
        recs: list[Recommendation] = []
        if lint_errors > 0:
            recs.append(Recommendation(
                category="quality",
                title=f"Fix {lint_errors} lint error(s)",
                reason="Broken links or missing spec files degrade documentation quality",
                action="/spec-lint",
            ))
        if stale_count > 0:
            recs.append(Recommendation(
                category="freshness",
                title=f"Update {stale_count} stale spec(s)",
                reason="Code has changed since these specs were last updated",
                action="/spec-review",
            ))
        if coverage_pct < 80:
            recs.append(Recommendation(
                category="coverage",
                title=f"Improve coverage ({coverage_pct}%)",
                reason="Several source directories lack specification",
                action="/spec-from-code",
            ))
        if tasks_pending > 0 and phase == "implementation":
            recs.append(Recommendation(
                category="progress",
                title=f"Complete {tasks_pending} pending task(s)",
                reason="Implementation tasks are in progress",
                action="/spec-next",
            ))
        return recs
