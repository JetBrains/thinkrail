"""Context assembly pipeline for agent sessions.

Builds the system prompt from skill instructions, project metadata,
and specification content.  See CONTEXT.md for the full spec.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.agent.models import AgentConfig
from app.spec.service import SpecService

_FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)


def _strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter (between first two ``---`` lines)."""
    return _FRONTMATTER_RE.sub("", text).lstrip()


def _load_skill(skill_id: str, plugin_dir: Path) -> str:
    """Read a SKILL.md file and return its body (frontmatter stripped)."""
    skill_path = plugin_dir / "skills" / skill_id / "SKILL.md"
    if not skill_path.is_file():
        raise FileNotFoundError(
            f"Skill '{skill_id}' not found: {skill_path} does not exist"
        )
    raw = skill_path.read_text(encoding="utf-8")
    return _strip_frontmatter(raw)


def build_context(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
) -> str:
    """Assemble the full system prompt for an agent session.

    Sections are ordered: Skill -> Project -> Specs, with framing
    prompts between them so the LLM can distinguish context types.
    """
    if plugin_dir is None:
        raise ValueError("plugin_dir is required (set via AppConfig.plugin_dir)")
    sections: list[str] = []

    # 1. Skill instructions
    if skill_id is not None:
        body = _load_skill(skill_id, plugin_dir)
        sections.append(f"## Your Task\n\nYou are running the \"{skill_id}\" skill.\n\n{body}")

    # 2. Project metadata
    sections.append(f"## Project\n\nWorking directory: {project_root}")

    # 3. Specification content
    if spec_ids:
        spec_parts: list[str] = []
        for sid in spec_ids:
            detail = spec_service.get_spec(sid)
            spec_parts.append(f"### {detail.title}\n\n{detail.content}")
        specs_body = "\n\n---\n\n".join(spec_parts)
        sections.append(
            "## Specifications\n\n"
            "The following specifications provide context for this session.\n\n"
            + specs_body
        )

    return "\n\n".join(sections)
