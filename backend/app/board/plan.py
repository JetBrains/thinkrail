"""Plan document service — read/write/parse implementation plans as Markdown.

Plans live at ``.tr/tickets/{ticket_id}/plan.md`` (per-ticket artifact
folder). They are the orchestration blueprint for executing meta-ticket work
via agent sessions.
"""

from __future__ import annotations

import re
from datetime import date
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, Field

from app.board.artifact_paths import artifact_path, ensure_ticket_dir
from app.board.models import _CAMEL_CONFIG, _to_camel
from app.core.config import AppConfig
from app.core.fileio import ensure_dir, read_text, write_text


# -- Models -------------------------------------------------------------------

class StepStatus(StrEnum):
    PENDING = "pending"
    EXECUTING = "executing"
    DONE = "done"
    FAILED = "failed"


class PlanStatus(StrEnum):
    DRAFT = "draft"
    READY = "ready"
    EXECUTING = "executing"
    DONE = "done"


_STEP_TERMINAL = frozenset({StepStatus.DONE, StepStatus.FAILED})


def is_terminal(status: StepStatus) -> bool:
    """Step reached a final state (done or failed)."""
    return status in _STEP_TERMINAL


class SuccessCriterion(BaseModel):
    model_config = _CAMEL_CONFIG

    text: str
    checked: bool = False


class PlanStep(BaseModel):
    model_config = _CAMEL_CONFIG

    number: int
    title: str
    status: StepStatus = StepStatus.PENDING
    skill: str = "default"
    milestone_number: int = 1
    depends_on: list[int] = Field(default_factory=list)
    parallel_with: list[int] = Field(default_factory=list)
    input_spec_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None
    # Index into the orchestrator session's events.jsonl of the toolCallStart
    # for this step's Task subagent — set in subagent_mode. Mutually exclusive
    # with session_id (step-session mode).
    event_index: int | None = None
    agent_instructions: str = ""
    success_criteria: list[SuccessCriterion] = Field(default_factory=list)


class Milestone(BaseModel):
    model_config = _CAMEL_CONFIG

    number: int
    title: str
    description: str = ""
    steps: list[PlanStep] = Field(default_factory=list)

    @property
    def status(self) -> StepStatus:
        """Computed from step statuses."""
        if not self.steps:
            return StepStatus.PENDING
        if any(s.status == StepStatus.EXECUTING for s in self.steps):
            return StepStatus.EXECUTING
        if all(is_terminal(s.status) for s in self.steps):
            return StepStatus.DONE
        return StepStatus.PENDING


class Plan(BaseModel):
    model_config = _CAMEL_CONFIG

    ticket_id: str
    title: str
    status: PlanStatus = PlanStatus.DRAFT
    milestones: list[Milestone] = Field(default_factory=list)
    verification: list[SuccessCriterion] = Field(default_factory=list)

    def all_steps(self) -> list[PlanStep]:
        """Flatten all steps from all milestones."""
        result: list[PlanStep] = []
        for m in self.milestones:
            result.extend(m.steps)
        return result

    def unblocked_steps(self) -> list[PlanStep]:
        """Pending steps whose dependencies are all ``done``.

        When a step's ``depends_on`` is empty, falls back to linear ordering
        (step N depends on step N-1) so plans written before parallelism
        was supported still execute sequentially.

        Used by subagent-mode orchestration to fan out parallel-eligible
        work in one assistant turn — see TICKET_LIFECYCLE_DESIGN.md
        § Implementation orchestration modes.
        """
        steps = sorted(self.all_steps(), key=lambda s: s.number)
        by_number = {s.number: s for s in steps}
        unblocked: list[PlanStep] = []
        for step in steps:
            if step.status != StepStatus.PENDING:
                continue
            deps = step.depends_on or [
                s.number for s in steps if s.number < step.number
            ]
            if all(
                by_number.get(n) is not None and by_number[n].status == StepStatus.DONE
                for n in deps
            ):
                unblocked.append(step)
        return unblocked


# -- Markdown serialization ---------------------------------------------------

def _render_step(step: PlanStep, lines: list[str]) -> None:
    """Render a single step into the lines list."""
    lines.append(f"### Step {step.number}: {step.title}")
    lines.append(f"- **Status:** {step.status}")
    lines.append(f"- **Skill:** {step.skill}")
    if step.depends_on:
        deps = ", ".join(f"Step {d}" for d in step.depends_on)
        lines.append(f"- **Depends on:** {deps}")
    if step.parallel_with:
        par = ", ".join(f"Step {p}" for p in step.parallel_with)
        lines.append(f"- **Parallel with:** {par}")
    if step.input_spec_ids:
        specs = ", ".join(step.input_spec_ids)
        lines.append(f"- **Input specs:** [{specs}]")
    if step.session_id:
        lines.append(f"- **Session:** {step.session_id}")
    if step.agent_instructions:
        lines.append(f"- **Agent instructions:** {step.agent_instructions}")
    if step.success_criteria:
        lines.append("- **Success criteria:**")
        for c in step.success_criteria:
            check = "x" if c.checked else " "
            lines.append(f"  - [{check}] {c.text}")


def _render_plan(plan: Plan) -> str:
    """Render a Plan model to Markdown."""
    lines: list[str] = []
    lines.append(f"# Plan: {plan.title}")
    lines.append("")
    lines.append("## Meta")
    lines.append(f"- **Ticket:** {plan.ticket_id}")
    lines.append(f"- **Status:** {plan.status}")
    lines.append(f"- **Updated:** {date.today().isoformat()}")

    for milestone in plan.milestones:
        lines.append("")
        lines.append(f"## Milestone {milestone.number}: {milestone.title}")
        if milestone.description:
            lines.append(milestone.description)
        for step in milestone.steps:
            lines.append("")
            _render_step(step, lines)

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
    """Parse a plan Markdown document into a Plan model.

    Supports two formats:
    - **Milestone format**: ``## Milestone N: Title`` with nested ``### Step``
    - **Legacy flat format**: ``## Steps`` with ``### Step`` — wrapped in
      a single implicit milestone for backward compatibility.
    """
    title = ""
    status = PlanStatus.DRAFT
    milestones: list[Milestone] = []
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

    has_milestones = any(s.startswith("Milestone") for s in sections)

    if has_milestones:
        for section in sections:
            if section.startswith("Milestone"):
                milestones.append(_parse_milestone(section))
            elif section.startswith("Verification"):
                verification = _parse_criteria(section)
    else:
        # Legacy flat format — wrap in single milestone
        flat_steps: list[PlanStep] = []
        for section in sections:
            if section.startswith("Steps"):
                flat_steps = _parse_steps(section, milestone_number=1)
            elif section.startswith("Verification"):
                verification = _parse_criteria(section)
        if flat_steps:
            milestones = [Milestone(number=1, title="Implementation", steps=flat_steps)]

    return Plan(
        ticket_id=ticket_id,
        title=title,
        status=status,  # type: ignore[arg-type]
        milestones=milestones,
        verification=verification,
    )


def _parse_milestone(section: str) -> Milestone:
    """Parse a Milestone section into a Milestone model."""
    # First line: "Milestone N: Title\n..."
    header_match = re.match(r"Milestone\s+(\d+):\s*(.+)", section)
    number = int(header_match.group(1)) if header_match else 1
    title = header_match.group(2).strip() if header_match else "Untitled"

    # Description is text between the header and the first ### Step
    first_step = re.search(r"^###\s+", section, re.MULTILINE)
    description = ""
    if header_match and first_step:
        desc_text = section[header_match.end():first_step.start()].strip()
        if desc_text:
            description = desc_text

    steps = _parse_steps(section, milestone_number=number)
    return Milestone(number=number, title=title, description=description, steps=steps)


def _parse_steps(section: str, *, milestone_number: int = 1) -> list[PlanStep]:
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
        status = _extract_field(block, "Status") or StepStatus.PENDING
        skill = _extract_field(block, "Skill") or "default"
        session_id = _extract_field(block, "Session") or None
        agent_instructions = _extract_field(block, "Agent instructions") or ""

        # Parse depends on
        depends_on: list[int] = []
        deps_match = re.search(r"\*\*Depends on:\*\*\s*(.+)", block)
        if deps_match:
            for d in re.findall(r"Step\s+(\d+)", deps_match.group(1)):
                depends_on.append(int(d))

        # Parse parallel with
        parallel_with: list[int] = []
        par_match = re.search(r"\*\*Parallel with:\*\*\s*(.+)", block)
        if par_match:
            for p in re.findall(r"Step\s+(\d+)", par_match.group(1)):
                parallel_with.append(int(p))

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
            milestone_number=milestone_number,
            depends_on=depends_on,
            parallel_with=parallel_with,
            input_spec_ids=input_spec_ids,
            session_id=session_id,
            agent_instructions=agent_instructions,
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
    def _project_root(self) -> Path:
        return self._config.get_project_root()

    def _plan_path(self, ticket_id: str) -> Path:
        return artifact_path(self._project_root, ticket_id, "implementation_plan")

    def _relative_plan_path(self, ticket_id: str) -> str:
        return self._plan_path(ticket_id).relative_to(self._project_root).as_posix()

    def plan_exists(self, ticket_id: str) -> bool:
        return self._plan_path(ticket_id).is_file()

    def read_plan(self, ticket_id: str) -> Plan:
        """Read and parse a plan from disk."""
        path = self._plan_path(ticket_id)
        content = read_text(path)
        return _parse_plan(content, ticket_id)

    def write_plan(self, ticket_id: str, plan: Plan) -> str:
        """Write a plan to disk. Returns the project-relative plan path."""
        ensure_ticket_dir(self._project_root, ticket_id)
        path = self._plan_path(ticket_id)
        content = _render_plan(plan)
        ensure_dir(path.parent)
        write_text(path, content)
        return self._relative_plan_path(ticket_id)

    def create_plan(self, ticket_id: str, title: str, steps: list[PlanStep],
                    verification: list[SuccessCriterion] | None = None) -> Plan:
        """Create a new plan and write to disk.

        For backward compatibility, accepts a flat list of steps and wraps
        them in a single milestone.
        """
        milestones = [Milestone(number=1, title="Implementation", steps=steps)]
        plan = Plan(
            ticket_id=ticket_id,
            title=title,
            status=PlanStatus.DRAFT,
            milestones=milestones,
            verification=verification or [],
        )
        self.write_plan(ticket_id, plan)
        return plan

    def update_step_status(
        self, ticket_id: str, step_number: int,
        status: StepStatus, session_id: str | None = None,
    ) -> Plan:
        """Update a step's status and optionally its session ID."""
        plan = self.read_plan(ticket_id)
        for step in plan.all_steps():
            if step.number == step_number:
                step.status = status
                if session_id is not None:
                    step.session_id = session_id
                break
        # Auto-update plan status
        all_steps = plan.all_steps()
        if any(s.status == StepStatus.EXECUTING for s in all_steps):
            plan.status = PlanStatus.EXECUTING
        if all(is_terminal(s.status) for s in all_steps) and all_steps:
            plan.status = PlanStatus.DONE
        self.write_plan(ticket_id, plan)
        return plan

    def check_criterion(
        self, ticket_id: str, step_number: int, criterion_index: int, checked: bool,
    ) -> Plan:
        """Toggle a success criterion checkbox."""
        plan = self.read_plan(ticket_id)
        for step in plan.all_steps():
            if step.number == step_number:
                if 0 <= criterion_index < len(step.success_criteria):
                    step.success_criteria[criterion_index].checked = checked
                break
        self.write_plan(ticket_id, plan)
        return plan

    def read_plan_raw(self, ticket_id: str) -> str:
        """Read the raw markdown content of a plan file."""
        path = self._plan_path(ticket_id)
        return read_text(path)

    def write_plan_raw(self, ticket_id: str, content: str) -> Plan:
        """Write raw markdown to disk, re-parse, and return the Plan."""
        path = self._plan_path(ticket_id)
        ensure_dir(path.parent)
        write_text(path, content)
        return _parse_plan(content, ticket_id)

    def save_plan(self, ticket_id: str, plan: Plan) -> Plan:
        """Write a full structured Plan to disk."""
        self.write_plan(ticket_id, plan)
        return plan

    def get_next_step(self, ticket_id: str) -> PlanStep | None:
        """Find the next unblocked pending step, respecting milestone order."""
        plan = self.read_plan(ticket_id)
        all_steps = plan.all_steps()
        done_steps = {s.number for s in all_steps if s.status == StepStatus.DONE}
        for step in all_steps:
            if step.status != StepStatus.PENDING:
                continue
            # Check dependencies
            if all(d in done_steps for d in step.depends_on):
                return step
        return None
