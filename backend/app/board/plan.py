"""Plan document service — read/write/parse implementation plans as Markdown.

Plans live at `.bonsai/plans/{ticket_id}.md` and are the orchestration blueprint
for executing meta-ticket work via agent sessions.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from app.board.models import _CAMEL_CONFIG, _to_camel
from app.core.config import AppConfig
from app.core.fileio import ensure_dir, read_text, write_text


# -- Models -------------------------------------------------------------------

class SuccessCriterion(BaseModel):
    model_config = _CAMEL_CONFIG

    text: str
    checked: bool = False


class PlanStep(BaseModel):
    model_config = _CAMEL_CONFIG

    number: int
    title: str
    status: Literal["pending", "executing", "done", "failed"] = "pending"
    skill: str = "default"
    depends_on: list[int] = Field(default_factory=list)
    input_spec_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    success_criteria: list[SuccessCriterion] = Field(default_factory=list)


class Plan(BaseModel):
    model_config = _CAMEL_CONFIG

    ticket_id: str
    title: str
    status: Literal["draft", "ready", "executing", "done"] = "draft"
    steps: list[PlanStep] = Field(default_factory=list)
    verification: list[SuccessCriterion] = Field(default_factory=list)


# -- Markdown serialization ---------------------------------------------------

def _render_plan(plan: Plan) -> str:
    """Render a Plan model to Markdown."""
    lines: list[str] = []
    lines.append(f"# Plan: {plan.title}")
    lines.append("")
    lines.append("## Meta")
    lines.append(f"- **Ticket:** {plan.ticket_id}")
    lines.append(f"- **Status:** {plan.status}")
    lines.append(f"- **Updated:** {date.today().isoformat()}")
    lines.append("")
    lines.append("## Steps")

    for step in plan.steps:
        lines.append("")
        lines.append(f"### Step {step.number}: {step.title}")
        lines.append(f"- **Status:** {step.status}")
        lines.append(f"- **Skill:** {step.skill}")
        if step.depends_on:
            deps = ", ".join(f"Step {d}" for d in step.depends_on)
            lines.append(f"- **Depends on:** {deps}")
        if step.input_spec_ids:
            specs = ", ".join(step.input_spec_ids)
            lines.append(f"- **Input specs:** [{specs}]")
        if step.session_id:
            lines.append(f"- **Session:** {step.session_id}")
        if step.success_criteria:
            lines.append("- **Success criteria:**")
            for c in step.success_criteria:
                check = "x" if c.checked else " "
                lines.append(f"  - [{check}] {c.text}")

    if plan.verification:
        lines.append("")
        lines.append("## Verification")
        for c in plan.verification:
            check = "x" if c.checked else " "
            lines.append(f"- [{check}] {c.text}")

    lines.append("")
    return "\n".join(lines)


# -- Markdown parsing ---------------------------------------------------------

def _parse_plan(content: str, ticket_id: str) -> Plan:
    """Parse a plan Markdown document into a Plan model."""
    title = ""
    status = "draft"
    steps: list[PlanStep] = []
    verification: list[SuccessCriterion] = []

    # Extract title from first heading
    title_match = re.search(r"^#\s+Plan:\s*(.+)$", content, re.MULTILINE)
    if title_match:
        title = title_match.group(1).strip()

    # Extract status from Meta section
    status_match = re.search(r"^\s*-\s+\*\*Status:\*\*\s*(\w+)", content, re.MULTILINE)
    if status_match:
        status = status_match.group(1).strip()

    # Split into sections by ## headings
    sections = re.split(r"^##\s+", content, flags=re.MULTILINE)

    for section in sections:
        if section.startswith("Steps"):
            steps = _parse_steps(section)
        elif section.startswith("Verification"):
            verification = _parse_criteria(section)

    return Plan(
        ticket_id=ticket_id,
        title=title,
        status=status,  # type: ignore[arg-type]
        steps=steps,
        verification=verification,
    )


def _parse_steps(section: str) -> list[PlanStep]:
    """Parse the Steps section into PlanStep models."""
    steps: list[PlanStep] = []
    # Split by ### headings
    step_blocks = re.split(r"^###\s+", section, flags=re.MULTILINE)

    for block in step_blocks:
        step_match = re.match(r"Step\s+(\d+):\s*(.+)", block)
        if not step_match:
            continue

        number = int(step_match.group(1))
        title = step_match.group(2).strip()

        # Parse fields
        status = _extract_field(block, "Status") or "pending"
        skill = _extract_field(block, "Skill") or "default"
        session_id = _extract_field(block, "Session") or None

        # Parse depends on
        depends_on: list[int] = []
        deps_match = re.search(r"\*\*Depends on:\*\*\s*(.+)", block)
        if deps_match:
            for d in re.findall(r"Step\s+(\d+)", deps_match.group(1)):
                depends_on.append(int(d))

        # Parse input specs
        input_spec_ids: list[str] = []
        specs_match = re.search(r"\*\*Input specs:\*\*\s*\[([^\]]*)\]", block)
        if specs_match:
            for s in specs_match.group(1).split(","):
                s = s.strip()
                if s:
                    input_spec_ids.append(s)

        # Parse success criteria
        criteria = _parse_criteria(block)

        steps.append(PlanStep(
            number=number,
            title=title,
            status=status,  # type: ignore[arg-type]
            skill=skill,
            depends_on=depends_on,
            input_spec_ids=input_spec_ids,
            session_id=session_id,
            success_criteria=criteria,
        ))

    return steps


def _parse_criteria(text: str) -> list[SuccessCriterion]:
    """Parse checkbox criteria from text."""
    criteria: list[SuccessCriterion] = []
    for match in re.finditer(r"- \[([ xX])\]\s+(.+)", text):
        checked = match.group(1).lower() == "x"
        criteria.append(SuccessCriterion(text=match.group(2).strip(), checked=checked))
    return criteria


def _extract_field(text: str, field: str) -> str | None:
    """Extract a bold field value like **Status:** value."""
    match = re.search(rf"\*\*{field}:\*\*\s*(.+)", text)
    if match:
        return match.group(1).strip()
    return None


# -- Service ------------------------------------------------------------------

class PlanService:
    """Read/write implementation plans for meta-tickets."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config

    @property
    def _plans_dir(self) -> Path:
        return self._config.get_project_root() / ".bonsai" / "plans"

    def _plan_path(self, ticket_id: str) -> Path:
        return self._plans_dir / f"{ticket_id}.md"

    def plan_exists(self, ticket_id: str) -> bool:
        return self._plan_path(ticket_id).is_file()

    def read_plan(self, ticket_id: str) -> Plan:
        """Read and parse a plan from disk."""
        path = self._plan_path(ticket_id)
        content = read_text(path)
        return _parse_plan(content, ticket_id)

    def write_plan(self, ticket_id: str, plan: Plan) -> str:
        """Write a plan to disk. Returns the relative plan path."""
        path = self._plan_path(ticket_id)
        content = _render_plan(plan)
        ensure_dir(path.parent)
        write_text(path, content)
        return f"plans/{ticket_id}.md"

    def create_plan(self, ticket_id: str, title: str, steps: list[PlanStep],
                    verification: list[SuccessCriterion] | None = None) -> Plan:
        """Create a new plan and write to disk."""
        plan = Plan(
            ticket_id=ticket_id,
            title=title,
            status="draft",
            steps=steps,
            verification=verification or [],
        )
        self.write_plan(ticket_id, plan)
        return plan

    def update_step_status(
        self, ticket_id: str, step_number: int,
        status: str, session_id: str | None = None,
    ) -> Plan:
        """Update a step's status and optionally its session ID."""
        plan = self.read_plan(ticket_id)
        for step in plan.steps:
            if step.number == step_number:
                step.status = status  # type: ignore[assignment]
                if session_id is not None:
                    step.session_id = session_id
                break
        # Auto-update plan status
        if any(s.status == "executing" for s in plan.steps):
            plan.status = "executing"
        if all(s.status in ("done", "failed") for s in plan.steps) and plan.steps:
            plan.status = "done"
        self.write_plan(ticket_id, plan)
        return plan

    def check_criterion(
        self, ticket_id: str, step_number: int, criterion_index: int, checked: bool,
    ) -> Plan:
        """Toggle a success criterion checkbox."""
        plan = self.read_plan(ticket_id)
        for step in plan.steps:
            if step.number == step_number:
                if 0 <= criterion_index < len(step.success_criteria):
                    step.success_criteria[criterion_index].checked = checked
                break
        self.write_plan(ticket_id, plan)
        return plan

    def get_next_step(self, ticket_id: str) -> PlanStep | None:
        """Find the next unblocked pending step."""
        plan = self.read_plan(ticket_id)
        done_steps = {s.number for s in plan.steps if s.status == "done"}
        for step in plan.steps:
            if step.status != "pending":
                continue
            # Check dependencies
            if all(d in done_steps for d in step.depends_on):
                return step
        return None
