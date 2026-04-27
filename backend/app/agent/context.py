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

# ── Token estimation ─────────────────────────────────────────────────────────

def _estimate_tokens_heuristic(text: str) -> int:
    """Fallback heuristic: ~6 chars per token for Claude's tokenizer."""
    return len(text) // 6


def _count_tokens_api(text: str, model: str) -> int | None:
    """Count tokens using the Anthropic API (free endpoint). Returns None on failure."""
    try:
        import anthropic
        client = anthropic.Anthropic()
        result = client.messages.count_tokens(
            model=model,
            system=text,
            messages=[{"role": "user", "content": "x"}],
        )
        # Subtract overhead from the dummy user message (~4 tokens)
        return max(0, result.input_tokens - 4)
    except Exception:
        return None


def _estimate_tokens(text: str, model: str | None = None) -> int:
    """Estimate token count: uses API if model is provided, falls back to heuristic."""
    if model:
        result = _count_tokens_api(text, model)
        if result is not None:
            return result
    return _estimate_tokens_heuristic(text)

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


def scan_skill_frontmatter(plugin_dir: Path) -> list[dict[str, str]]:
    """Scan all skills/*/SKILL.md, parse YAML frontmatter.

    Returns a sorted list of skill dicts with at minimum ``id``, ``name``,
    and ``description``.  Additional frontmatter fields (``icon``, ``group``,
    ``requires``) are included when present.
    """
    skills_dir = plugin_dir / "skills"
    if not skills_dir.is_dir():
        return []

    results: list[dict[str, str]] = []
    for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
        try:
            raw = skill_md.read_text(encoding="utf-8")
            fm = _parse_frontmatter(raw)
            name = fm.get("name", "")
            description = fm.get("description", "")
            if name and description:
                entry: dict[str, str] = {
                    "id": skill_md.parent.name,
                    "name": name,
                    "description": description,
                }
                for key in ("icon", "group", "requires"):
                    if key in fm:
                        entry[key] = fm[key]
                results.append(entry)
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
    vis = """\
### Visualization

You have access to the `bonsai_visualize` MCP tool for rendering structured visual \
output in the UI. Use it instead of ASCII art, markdown tables, or plain-text diagrams \
whenever the output would benefit from visual structure.

**Available types:** progress-tracker, summary-box, comparison, data-table, \
status-list, diagram.

**When to use:** reporting status, showing progress, comparing options, presenting \
tabular data, or illustrating architecture. Call the tool with a JSON object containing \
`type`, `title`, `data`, and optionally `visId` (reuse the same `visId` to update a \
previous visualization in-place). **Important:** `data` must be a JSON object, not a \
JSON string — pass `{"options": [...]}` directly, not `"{\"options\": [...]}"`.


**Status values:** `done`, `current`, `pending`, `error`, `skipped`, `stale` (use these exact strings).

**Layout hints (optional):** `"layout": {"width": "compact"|"normal"|"wide", "maxHeight": 300}`
Use `compact` for small status badges, `wide` for architecture diagrams.

**`data` format by type:**
- **progress-tracker:** `{"steps": [{"label": "...", "status": "done", "file?": "path"}]}`
- **summary-box:** `{"sections": [{"heading": "...", "status?": "done", "items": [{"label": "Key", "value": "Val"}]}]}`
- **comparison:** `{"options": [{"name": "...", "description?": "...", "pros?": ["..."], "cons?": ["..."], "visualization?": "graph LR; ..."}]}`
- **data-table:** `{"columns": ["Col1", "Col2"], "rows": [["a", "b"]], "statusColumn?": 1}`
- **status-list:** `{"items": [{"label": "...", "status": "done", "meta?": "detail text"}]}`
- **diagram:** `{"nodes": [{"id": "a", "label": "A"}], "edges": [{"from": "a", "to": "b", "label?": "calls"}]}` for structured, or `{"diagram": "graph LR; A-->B", "notation": "mermaid"}` for raw Mermaid

Prefer structured `nodes`/`edges` for new diagrams; use `notation: "mermaid"` only when raw Mermaid syntax is more expressive.

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

- Use `spec_search` at the start to understand project state and existing specs.
- After creating or modifying any spec file, use Write/Edit tools to update the spec file \
with YAML frontmatter, and use `spec_delete` for removing specs with cross-file cleanup.
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

    # 5. Frontmatter Format subsection (reference card)
    frontmatter = """\
### Frontmatter Format

Every spec file starts with YAML frontmatter between `---` delimiters. \
The file watcher validates and indexes it automatically.

```yaml
---
id: module-auth
type: module-design
status: active
parent: design-doc
depends-on:
  - module-core
covers:
  - backend/app/auth/
tags:
  - backend
---
```

**Required fields:**
- `id` — unique identifier (e.g. `module-auth`, `task-fix-login`)
- `type` — one of: goal-and-requirements, architecture-design, module-design, \
submodule-design, task-spec

**Optional fields:**
- `status` — draft (default), active, stale, done, deprecated
- `title` — display name (defaults to first `#` heading)
- `parent` — spec ID of the parent
- `depends-on` — list of spec IDs this depends on
- `references` — list of spec IDs this references
- `implements` — list of spec IDs this implements
- `covers` — list of source paths documented
- `tags` — list of labels"""

    # 6. Available Skills subsection (dynamically generated)
    skills = scan_skill_frontmatter(plugin_dir)
    if skills:
        rows = "\n".join(f"| {s['name']} | {s['description']} |" for s in skills)
        skills_table = f"""\
### Available Skills

| Skill | Description |
|-------|-------------|
{rows}"""
    else:
        skills_table = """\
### Available Skills

No skills available."""

    subsections = [vis, interaction, spec_workflow, proactive, frontmatter, skills_table]
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


async def _build_specs_section(spec_ids: list[str], spec_service: SpecService) -> str:
    """Load specs by ID, format as titled sections separated by ``---``.

    Gracefully skips specs that can't be loaded (not indexed yet, deleted,
    or index still initialising) — mirrors ``_build_spec_details`` behaviour.
    """
    spec_parts: list[str] = []
    skipped: list[str] = []
    for sid in spec_ids:
        try:
            detail = await spec_service.get_spec(sid)
            spec_parts.append(f"### {detail.title}\n\n{detail.content}")
        except Exception:
            logger.warning("Skipping spec '%s': not available in index", sid)
            skipped.append(sid)
    if not spec_parts and not skipped:
        return ""
    specs_body = "\n\n---\n\n".join(spec_parts)
    header = (
        "## Specifications\n\n"
        "The following specifications provide context for this session.\n\n"
    )
    if skipped:
        header += (
            f"**Note:** {len(skipped)} spec(s) could not be loaded "
            f"({', '.join(skipped)}) — index may still be initialising.\n\n"
        )
    return header + specs_body


async def _build_spec_details(
    spec_ids: list[str], spec_service: SpecService,
) -> list[dict]:
    """Return per-spec metadata for the structured prompt view."""
    details: list[dict] = []
    for sid in spec_ids:
        try:
            detail = await spec_service.get_spec(sid)
            details.append({
                "id": detail.id,
                "title": detail.title,
                "content": detail.content,
                "tokens": _estimate_tokens_heuristic(detail.content),
            })
        except Exception:
            pass
    return details


def _read_file_preview(project_root: Path, rel_path: str, max_lines: int = 30) -> str:
    """Read first N lines of a file for UI preview. Returns empty string on failure.

    Handles both relative (project) paths and absolute (external) paths.
    """
    try:
        p = Path(rel_path)
        full = p if p.is_absolute() else project_root / rel_path
        if not full.is_file():
            return ""
        lines = full.read_text(encoding="utf-8", errors="replace").splitlines()[:max_lines]
        return "\n".join(lines)
    except Exception:
        return ""


def _build_files_section(file_paths: list[str]) -> str:
    """Build the Relevant Files section for the system prompt (paths only)."""
    listing = "\n".join(f"- {p}" for p in file_paths)
    return (
        "## Relevant Files\n\n"
        "The user has flagged these files as potentially relevant to this session.\n"
        "Read them if you need their content.\n\n"
        + listing
    )


def _build_file_details(
    file_paths: list[str], project_root: Path,
) -> list[dict]:
    """Return per-file metadata for the structured prompt view."""
    details: list[dict] = []
    for p in file_paths:
        name = p.rsplit("/", 1)[-1] if "/" in p else p
        preview = _read_file_preview(project_root, p)
        details.append({
            "path": p,
            "name": name,
            "preview": preview,
            "tokens": _estimate_tokens_heuristic(preview),
        })
    return details


_MAX_CONTEXT_CHARS = 4000


def build_parent_context(
    parent_sid: str,
    subsession_type: "SubsessionType",
    subsession_context: str | None,
    project_root: Path,
) -> str:
    """Build system prompt section with parent conversation context."""
    from app.agent.models import SubsessionType  # avoid circular import
    from app.agent.persistence import load_events

    events = load_events(project_root, parent_sid)
    transcript = _extract_transcript(events)

    if len(transcript) > _MAX_CONTEXT_CHARS:
        transcript = _truncate_transcript(transcript, _MAX_CONTEXT_CHARS)

    if subsession_type == SubsessionType.refinement:
        role_text = (
            "You are a message editor. Your ONLY job is to clean up the voice transcript "
            "below into a well-formulated message.\n\n"
            "CRITICAL: You MUST use the AskUserQuestion tool. "
            "Do NOT write proposals as plain text. ALWAYS use the tool.\n\n"
            "STEP 1 — PROPOSE VERSIONS:\n"
            "Call AskUserQuestion with EXACTLY this structure:\n"
            '- question: "Pick the best formulation to send to the parent session:"\n'
            "- You MUST provide ALL of these options (2-3 versions + adjust):\n"
            '  - Option A label: "Minimal cleanup"\n'
            "    Option A description: the full cleaned-up text (grammar/spelling fixed, "
            "filler removed, but preserving the original structure)\n"
            '  - Option B label: "Concise & polished"\n'
            "    Option B description: the full rewritten text (extract the core essence, "
            "well-formulated, professional tone, shorter)\n"
            '  - Option C label: "Adjust — let me describe what I want"\n'
            "    Option C description: I'll provide feedback for a revision\n"
            "- IMPORTANT: Options A and B descriptions must contain the COMPLETE message text, "
            "not a summary of it. The user will send the chosen text to the parent.\n\n"
            "STEP 2 — AFTER USER PICKS:\n"
            "- If user picks Option A or B: respond with ONLY this exact text:\n"
            '  "Returning to parent session with your message."\n'
            "  The system will handle propagating the chosen text back.\n"
            "- If user picks 'Adjust': ask what to change, "
            "then call AskUserQuestion again with revised versions.\n\n"
            "RULES:\n"
            "- NEVER respond with plain text proposals. ALWAYS use AskUserQuestion.\n"
            "- ALWAYS provide at least 2 different formulations (minimal + polished).\n"
            "- Each option description must be the COMPLETE ready-to-send message.\n"
            "- Do NOT add content the user didn't say. Do NOT explain edits."
        )
        purpose = "quickly clean up a voice transcript into a well-formulated message"
    else:
        role_text = (
            "Discuss the topic thoroughly. When the user is satisfied, "
            "propose a concise summary to bring back to the parent session."
        )
        purpose = "discuss a topic"

    sections = [
        f"## Parent Session Context\n\nYou are in a subsession branched from a parent conversation.\nThe user wants to {purpose} without polluting the main session."
    ]
    if transcript.strip():
        sections.append(f"### Parent Conversation:\n{transcript}")
    if subsession_context:
        sections.append(f"### Focus:\n{subsession_context}")
    sections.append(f"### Your Role:\n{role_text}")

    return "\n\n".join(sections)


def _extract_transcript(events: list[dict]) -> str:
    """Extract user messages and assistant text from events into a transcript."""
    turns: list[str] = []
    current_assistant_text: list[str] = []

    for ev in events:
        event_type = ev.get("eventType", "")
        payload = ev.get("payload", {})

        if event_type == "userMessage":
            if current_assistant_text:
                turns.append("**Assistant:** " + "".join(current_assistant_text))
                current_assistant_text = []
            turns.append("**User:** " + payload.get("text", ""))
        elif event_type == "textDelta":
            current_assistant_text.append(payload.get("text", ""))
        elif event_type == "turnComplete":
            if current_assistant_text:
                turns.append("**Assistant:** " + "".join(current_assistant_text))
                current_assistant_text = []

    if current_assistant_text:
        turns.append("**Assistant:** " + "".join(current_assistant_text))

    return "\n\n".join(turns)


def _truncate_transcript(transcript: str, max_chars: int) -> str:
    """Keep the most recent turns that fit within max_chars."""
    parts = transcript.split("\n\n")
    result: list[str] = []
    total = 0
    for part in reversed(parts):
        if total + len(part) + 2 > max_chars and result:
            break
        result.append(part)
        total += len(part) + 2
    result.reverse()
    if len(result) < len(parts):
        return "[Earlier conversation truncated]\n\n" + "\n\n".join(result)
    return "\n\n".join(result)


def _get_model_context_max(model_id: str) -> int:
    """Look up the context window for a model from the hardcoded fallback.

    Used for budget estimation in contexts where the live model registry
    is not available (e.g. context.py has no access to the service).
    """
    from app.agent.model_registry import _FALLBACK
    for m in _FALLBACK:
        if m["id"] == model_id:
            return m["contextWindow"]
    return 200_000


SECTION_LABELS: dict[str, str] = {
    "general": "General Instructions",
    "task": "Skill / Task",
    "project": "Project",
    "files": "Relevant Files",
    "specs": "Specifications",
}


async def build_context(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
    session_prompt: str | None = None,
    file_paths: list[str] | None = None,
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

    # 4. Relevant files (paths only)
    if file_paths:
        sections.append(_build_files_section(file_paths))

    # 5. Specification content
    if spec_ids:
        sections.append(await _build_specs_section(spec_ids, spec_service))

    return "\n\n".join(sections)


async def build_context_structured(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
    session_prompt: str | None = None,
    file_paths: list[str] | None = None,
) -> dict:
    """Build context and return structured section data for the prompt preview.

    Returns a dict with:
      - ``full``: the complete system prompt string
      - ``sections``: list of section dicts with key, label, content, tokens
      - ``totalTokens``: estimated total tokens
    """
    if plugin_dir is None:
        raise ValueError("plugin_dir is required")
    model = config.model if config else None

    ordered: list[tuple[str, str]] = []

    # 1. General
    general = _build_general_instructions(plugin_dir)
    ordered.append(("general", general))

    # 2. Task
    task_parts: list[str] = []
    if skill_id is not None:
        task_parts.append(f'You are running the "{skill_id}" skill.')
    if session_prompt:
        task_parts.append(session_prompt)
    if skill_id is not None:
        body = _load_skill(skill_id, plugin_dir)
        if session_prompt:
            task_parts.append(f"---\n\n{body}")
        else:
            task_parts.append(body)
    if task_parts:
        ordered.append(("task", "## Your Task\n\n" + "\n\n".join(task_parts)))

    # 3. Project
    ordered.append(("project", f"## Project\n\nWorking directory: {project_root}"))

    # 4. Files
    if file_paths:
        ordered.append(("files", _build_files_section(file_paths)))

    # 5. Specs
    if spec_ids:
        ordered.append(("specs", await _build_specs_section(spec_ids, spec_service)))

    full = "\n\n".join(content for _, content in ordered)

    sections = []
    for key, content in ordered:
        section: dict = {
            "key": key,
            "label": SECTION_LABELS.get(key, key),
            "content": content,
            "tokens": _estimate_tokens(content, model),
        }
        if key == "specs":
            section["specDetails"] = await _build_spec_details(spec_ids, spec_service)
        if key == "files":
            section["fileDetails"] = _build_file_details(file_paths or [], project_root)
        sections.append(section)

    total_tokens = sum(s["tokens"] for s in sections)
    context_max = _get_model_context_max(config.model) if config else 200_000
    ratio = total_tokens / context_max if context_max > 0 else 0
    warnings: list[str] = []
    if ratio > 0.8:
        warnings.append(
            f"System prompt uses {int(ratio * 100)}% of context window "
            f"({total_tokens:,} / {context_max:,} tokens). "
            "Very limited room for conversation."
        )
    elif ratio > 0.4:
        warnings.append(
            f"System prompt uses {int(ratio * 100)}% of context window. "
            "Consider removing some specs for longer conversations."
        )

    return {
        "full": full,
        "sections": sections,
        "totalTokens": total_tokens,
        "contextMax": context_max,
        "budgetRatio": round(ratio, 3),
        "warnings": warnings,
    }
