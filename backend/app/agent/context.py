"""Context assembly pipeline for agent sessions.

Builds the system prompt from general instructions, skill instructions,
project metadata, and specification content.

Section ordering: General Instructions → Skill → Project → Specs.
See CONTEXT.md for the full spec.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from app.agent.models import AgentConfig
from app.spec.service import SpecService

logger = logging.getLogger(__name__)

_FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


def _strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter (between first two ``---`` lines)."""
    return _FRONTMATTER_RE.sub("", text).lstrip()


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Extract simple key-value YAML frontmatter from a SKILL.md file.

    Handles the simple ``key: value`` format used in skill frontmatter
    without requiring PyYAML.  Returns an empty dict if no valid
    frontmatter is found.
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[4:end]
    result: dict[str, str] = {}
    for line in block.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon == -1:
            continue
        key = line[:colon].strip()
        # Strip optional surrounding quotes from value
        val = line[colon + 1 :].strip().strip("\"'")
        if key and val:
            result[key] = val
    return result


def _scan_skill_frontmatter(plugin_dir: Path) -> list[tuple[str, str]]:
    """Scan all skills/*/SKILL.md, parse YAML frontmatter.

    Returns a sorted list of ``(name, description)`` tuples.
    Gracefully skips files with malformed frontmatter.
    """
    skills_dir = plugin_dir / "skills"
    if not skills_dir.is_dir():
        return []

    results: list[tuple[str, str]] = []
    for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
        try:
            raw = skill_md.read_text(encoding="utf-8")
            fm = _parse_frontmatter(raw)
            name = fm.get("name", "")
            description = fm.get("description", "")
            if name and description:
                results.append((name, description))
            else:
                logger.warning(
                    "Skipping %s: missing name or description in frontmatter",
                    skill_md,
                )
        except OSError:
            logger.warning("Could not read %s", skill_md, exc_info=True)

    return results


def _build_general_instructions(plugin_dir: Path) -> str:
    """Compose the General Instructions section with all subsections.

    This section is always present in the system prompt and provides
    behavioral rules for visualization, interaction, spec workflow,
    proactive suggestions, and available skills.
    """
    # 1. Visualization subsection
    viz = """\
### Visualization

You have access to the `bonsai_visualize` MCP tool for rendering structured visual \
output in the UI. Use it instead of ASCII art, markdown tables, or plain-text diagrams \
whenever the output would benefit from visual structure.

**Available types:** progress-tracker, summary-box, comparison, data-table, \
status-list, diagram.

**When to use:** reporting status, showing progress, comparing options, presenting \
tabular data, or illustrating architecture. Call the tool with a JSON object containing \
`type`, `title`, `data`, and optionally `vizId` (reuse the same `vizId` to update a \
previous visualization in-place).

**Anti-patterns:** Do NOT use Bash to print ANSI-colored text, do NOT render ASCII-art \
tables, do NOT approximate visualizations with markdown when the tool can do it better."""

    # 2. Interaction Style subsection
    interaction = """\
### Interaction Style

- Use the `AskUserQuestion` tool for every user-facing decision. Offer 2-4 concrete \
choices per question.
- After completing the primary task, use `AskUserQuestion` to offer relevant next \
actions, always including "Done for now" as an option.
- Prefer structured choices over open-ended questions."""

    # 3. Spec-Driven Workflow subsection
    spec_workflow = """\
### Spec-Driven Workflow

- Use `spec_list` or `registry_query` at the start to understand project state and existing specs.
- After creating or modifying any spec file, use `spec_save` and `registry_mutate` to \
update the registry with the appropriate entry and links.
- Respect the spec hierarchy: Goal > Architecture > Modules > Submodules > Tasks."""

    # 4. Proactive Suggestions subsection
    proactive = """\
### Proactive Suggestions

When you complete a task or discover follow-up work, use the `SuggestSession` tool \
to propose a new session instead of just mentioning it. Common triggers:
- Next step in the project plan
- Have several independent directions/modules to design/implement
- Implementation tasks should be created for a spec you just wrote

Include relevant `specIds` so the new session starts with the right context. \
Use `prompt` to carry over specific instructions or focus areas for the new session. \
Write a `reason` that explains *why* this follow-up matters now.

The developer sees a card and can approve or dismiss. \
Respect dismissals — do not re-suggest the same session. Limit to 1-3 per session."""

    # 5. Available Skills subsection (dynamically generated)
    skills = _scan_skill_frontmatter(plugin_dir)
    if skills:
        rows = "\n".join(f"| {name} | {desc} |" for name, desc in skills)
        skills_table = f"""\
### Available Skills

| Skill | Description |
|-------|-------------|
{rows}"""
    else:
        skills_table = """\
### Available Skills

No skills available."""

    subsections = [viz, interaction, spec_workflow, proactive, skills_table]
    body = "\n\n".join(subsections)
    return f"## General Instructions\n\n{body}"


def _load_skill(skill_id: str, plugin_dir: Path) -> str:
    """Read a SKILL.md file and return its body (frontmatter stripped)."""
    skill_path = plugin_dir / "skills" / skill_id / "SKILL.md"
    if not skill_path.is_file():
        raise FileNotFoundError(
            f"Skill '{skill_id}' not found: {skill_path} does not exist"
        )
    raw = skill_path.read_text(encoding="utf-8")
    return _strip_frontmatter(raw)


def _build_specs_section(spec_ids: list[str], spec_service: SpecService) -> str:
    """Load specs by ID, format as titled sections separated by ``---``."""
    spec_parts: list[str] = []
    for sid in spec_ids:
        detail = spec_service.get_spec(sid)
        spec_parts.append(f"### {detail.title}\n\n{detail.content}")
    specs_body = "\n\n---\n\n".join(spec_parts)
    return (
        "## Specifications\n\n"
        "The following specifications provide context for this session.\n\n"
        + specs_body
    )


def build_context(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
    session_prompt: str | None = None,
) -> str:
    """Assemble the full system prompt for an agent session.

    Sections are ordered:
      1. General Instructions (always)
      2. Your Task — skill header + session_prompt + SKILL.md body
      3. Project metadata (always)
      4. Specification content (if spec_ids)

    When ``session_prompt`` is provided, it is placed inside the
    "Your Task" section between the skill header line and the
    SKILL.md body (separated by ``---``).  If no ``skill_id`` is
    given but ``session_prompt`` is, a "Your Task" section is still
    created with just the prompt.

    See CONTEXT.md for the full specification.
    """
    if plugin_dir is None:
        raise ValueError("plugin_dir is required (set via AppConfig.plugin_dir)")
    sections: list[str] = []

    # 1. General Instructions (always present)
    sections.append(_build_general_instructions(plugin_dir))

    # 2. Your Task — combines skill header, session prompt, and SKILL.md body
    task_parts: list[str] = []
    if skill_id is not None:
        task_parts.append(f'You are running the "{skill_id}" skill.')
    if session_prompt:
        task_parts.append(session_prompt)
    if skill_id is not None:
        body = _load_skill(skill_id, plugin_dir)
        # Separate prompt from skill body with a rule if both present
        if session_prompt:
            task_parts.append(f"---\n\n{body}")
        else:
            task_parts.append(body)
    if task_parts:
        sections.append("## Your Task\n\n" + "\n\n".join(task_parts))

    # 3. Project metadata
    sections.append(f"## Project\n\nWorking directory: {project_root}")

    # 4. Specification content
    if spec_ids:
        sections.append(_build_specs_section(spec_ids, spec_service))

    return "\n\n".join(sections)
