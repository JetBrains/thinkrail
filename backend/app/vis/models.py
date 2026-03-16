from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class WorkflowStep:
    id: str
    label: str
    status: str  # "completed" | "in_progress" | "pending"
    file: str | None = None


@dataclass
class CoverageEntry:
    path: str
    spec_id: str | None
    spec_path: str | None
    freshness: str  # "fresh" | "stale" | "n/a" | "uncovered"


@dataclass
class TaskEntry:
    id: str
    path: str
    module: str
    status: str


@dataclass
class LintIssue:
    spec_id: str | None
    path: str
    severity: str  # "error" | "warning"
    category: str
    message: str
    fixable: bool


@dataclass
class Recommendation:
    category: str
    title: str
    reason: str
    action: str


@dataclass
class DashboardState:
    # Summary metrics
    coverage_pct: int = 0
    spec_count: int = 0
    active_count: int = 0
    stale_count: int = 0
    task_count: int = 0
    tasks_done: int = 0
    tasks_pending: int = 0
    lint_errors: int = 0
    lint_warnings: int = 0
    # Workflow
    workflow_phase: str = "unknown"
    workflow_steps: list[WorkflowStep] = field(default_factory=list)
    # Detail
    coverage: list[CoverageEntry] = field(default_factory=list)
    pending_tasks: list[TaskEntry] = field(default_factory=list)
    lint_issues: list[LintIssue] = field(default_factory=list)
    recommendations: list[Recommendation] = field(default_factory=list)
    # Meta
    computed_at: str = ""
    one_liner: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
