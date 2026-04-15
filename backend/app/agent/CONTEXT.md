# Agent Context — Submodule Specification

> Parent: [Agent Module](README.md) | Status: **Active** | Created: 2026-03-03 | Updated: 2026-03-13

## Purpose

The Context submodule is responsible for assembling the full prompt context that feeds an agent session. It gathers content from multiple sources — general behavioral instructions (built-in), skill instructions (loaded from plugin SKILL.md files), project metadata (working directory path and configuration), and specification documents (loaded by ID from the registry) — and composes them into a structured system prompt passed to the Claude Agent SDK. It owns the ordering, formatting, framing, and separation of context sections.

## Architecture

**Pattern:** Pipeline — gather → compose.

The pipeline assembles four context sections in a fixed order. General Instructions are always present and set the behavioral foundation. Skill instructions narrow the task. Project metadata and specs provide domain context.

```
  Inputs
  ┌────────────┐  ┌────────────────┐  ┌─────────────┐  ┌────────────┐
  │ skill_id   │  │ spec_ids[]     │  │ project_root│  │ plugin_dir │
  │ (optional) │  │ (from registry)│  │ (Path)      │  │ (Path)     │
  └─────┬──────┘  └───────┬────────┘  └──────┬──────┘  └─────┬──────┘
        │                 │                   │               │
        ▼                 ▼                   ▼               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                    build_context()                               │
  │                                                                 │
  │  1. Build General Instructions (always)                         │
  │     a. Scan skills/ dir for available skills table              │
  │     b. Compose visualization rules, interaction style, spec workflow      │
  │  2. Load skill instructions from SKILL.md (if skill_id)        │
  │  3. Gather project metadata (always)                            │
  │  4. Load spec content by IDs (if spec_ids)                      │
  │  5. Compose all sections with framing prompts                   │
  │                                                                 │
  └──────────────────────────┬──────────────────────────────────────┘
                             │
                             ▼
                    system_prompt (str)
                             │
                             ▼
              ClaudeAgentOptions(system_prompt=...)
```

## Public Interface

### `build_context`

```python
def build_context(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
    session_prompt: str | None = None,
) -> str:
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `spec_ids` | `list[str]` | Registry spec IDs to load as context |
| `skill_id` | `str \| None` | Plugin skill ID (e.g., `"module-design"`). `None` for free-form sessions. |
| `project_root` | `Path` | Absolute path to the project directory |
| `config` | `AgentConfig` | Run configuration — may influence context composition (e.g., permission_mode) |
| `spec_service` | `SpecService` | Service to load spec content by ID |
| `plugin_dir` | `Path` | Bonsai's plugin directory (contains `skills/`). Set via `AppConfig.plugin_dir`, which resolves to the `claude-plugin/` directory in the Bonsai installation (not the target project). |
| `session_prompt` | `str \| None` | Custom instructions or task description for this session. Placed inside the "Your Task" section before the SKILL.md body. Passed via `agent/run` RPC `prompt` param or `SuggestSession` tool. |

**Returns:** A composed system prompt string with framing sections.

**Raises:**
- `FileNotFoundError` — if `skill_id` is provided but SKILL.md does not exist at the expected path
- No error for empty `spec_ids` — returns prompt with general instructions + project sections only

### `build_context_structured`

Same signature as `build_context`, but returns structured section data for the prompt preview UI instead of a flat string.

```python
def build_context_structured(
    spec_ids: list[str],
    skill_id: str | None,
    project_root: Path,
    config: AgentConfig,
    spec_service: SpecService,
    plugin_dir: Path | None = None,
    session_prompt: str | None = None,
) -> dict:
```

**Returns:** A dict with:
- `full` (`str`) — the complete system prompt (same as `build_context` output)
- `sections` (`list[dict]`) — each section with `key`, `label`, `content`, `tokens`. Specs section includes `specDetails` with per-spec breakdown.
- `totalTokens` (`int`) — estimated total tokens (via Anthropic's `count_tokens` API when available, falls back to `len(text) // 6` heuristic)

**Section keys:** `"general"`, `"task"`, `"project"`, `"specs"` — mapped to labels via `SECTION_LABELS` constant.

Used by `AgentService.update_draft()` to provide the DraftConfigCard's structured prompt preview (stacked bar + collapsible sections).

## Context Sections & Ordering

The system prompt is assembled in this order, with framing text between sections:

### 1. General Instructions (always present)

```
## General Instructions

### Visualization

You have access to the `bonsai_visualize` MCP tool for rendering structured visual
output in the UI. Use it instead of ASCII art, markdown tables, or plain-text diagrams
whenever the output would benefit from visual structure.

**Available types:** progress-tracker, summary-box, comparison, data-table, status-list, diagram.

**When to use:** reporting status, showing progress, comparing options, presenting tabular
data, or illustrating architecture. Call the tool with a JSON object containing `type`,
`title`, `data`, and optionally `visId` (reuse the same `visId` to update a previous
visualization in-place).

**Anti-patterns:** Do NOT use Bash to print ANSI-colored text, do NOT render ASCII-art
tables, do NOT approximate visualizations with markdown when the tool can do it better.

### Interaction Style

- Use the `AskUserQuestion` tool for every user-facing decision. Offer 2-4 concrete
  choices per question.
- After completing the primary task, use `AskUserQuestion` to offer relevant next
  actions, always including "Done for now" as an option.
- Prefer structured choices over open-ended questions.

### Spec-Driven Workflow

- Use `spec_list` or `registry_query` at the start to understand project state and existing specs.
- After creating or modifying any spec file, use `spec_save` and `registry_mutate` to
  update the registry with the appropriate entry and links.
- Respect the spec hierarchy: Goal > Architecture > Modules > Submodules > Tasks.

### Proactive Suggestions

When you complete a task or discover follow-up work, use the `SuggestSession` tool
to propose a new session instead of just mentioning it. Common triggers:
- Next step in the project plan
- Have several independent directions/modules to design/implement
- Implementation tasks should be created for a spec you just wrote

Include relevant `specIds` so the new session starts with the right context.
Use `prompt` to carry over specific instructions or focus areas for the new session.
Write a `reason` that explains *why* this follow-up matters now.

The developer sees a card and can approve or dismiss.
Respect dismissals — do not re-suggest the same session. Limit to 1-3 per session.

### Available Skills

| Skill | Description |
|-------|-------------|
| goal-and-requirements | Define project/feature goals and requirements |
| architecture-design | Create system-wide architecture design |
| module-design | Design a module-level specification |
| ... | (dynamically generated from SKILL.md frontmatter) |
```

This section is **always present** — every session (skill-based or free-form) receives these behavioral instructions. It replaces the former standalone "Visualization Tool" section and consolidates rules previously duplicated across 13 of 14 SKILL.md files.

**Skills table generation:** `build_context` scans `{plugin_dir}/skills/*/SKILL.md`, reads the YAML frontmatter from each file, and generates a compact table of `name` + `description`. This ensures the agent always knows what skills are available for recommending next actions, without hardcoding the list.

### 2. Your Task (if `skill_id` or `session_prompt` is provided)

```
## Your Task

You are running the "{skill_name}" skill.

{session_prompt — custom instructions from the caller}

---

{SKILL.md content — full prompt text from the skill file}
```

- This section is present when either `skill_id` or `session_prompt` is provided
- **Skill header:** `You are running the "{skill_id}" skill.` — only if `skill_id` is set
- **Session prompt:** Custom instructions placed after the skill header and before the SKILL.md body. Separated from the body by `---` when both are present. Source: `agent/run` RPC `prompt` param or `SuggestSession` tool `prompt` field.
- **SKILL.md body:** Loaded from `{plugin_dir}/skills/{skill_id}/SKILL.md`, YAML frontmatter stripped
- If only `session_prompt` is provided (no skill), the section contains just the prompt
- If neither `skill_id` nor `session_prompt` is provided, this section is omitted entirely
- **Skill files should no longer contain** visualization rules, interaction style mandates, or spec workflow instructions — those are now in General Instructions. Skills focus purely on their task-specific logic.

### 3. Project Metadata (always present)

```
## Project

Working directory: {project_root}
```

- Always present — every session has a project root
- May be extended in future with additional metadata (e.g., git branch, language, framework)

### 4. Specification Context (if `spec_ids` is non-empty)

```
## Specifications

The following specifications provide context for this session.

### {spec_1.title}

{spec_1.content}

---

### {spec_2.title}

{spec_2.content}
```

- Each spec is loaded via `spec_service.get_spec(id)` and rendered as a titled section
- Specs are separated by `---` horizontal rules
- If `spec_ids` is empty, this section is omitted

### Free-form Sessions

When both `skill_id` is `None` and `spec_ids` is empty, the system prompt contains:

1. **General Instructions** — behavioral rules, visualization tool reference, interaction style, spec workflow, and available skills table
2. **Project Metadata** — working directory

This ensures the agent always knows about `bonsai_visualize`, `AskUserQuestion` patterns, and available skills, even in free-form sessions with no skill or specs.

## General Instructions Content

The General Instructions section consolidates behavioral rules that were previously duplicated across skill files. This is the canonical source of truth for what goes into the section:

### Subsections

| Subsection | Content | Rationale |
|------------|---------|-----------|
| **Visualization** | `bonsai_visualize` tool reference, 6 available types, layout hints (`width`, `maxHeight`), 6 primary status values, when to use, anti-patterns (no Bash/ANSI/ASCII) | Previously copy-pasted into 13/14 skills. Without this, the model doesn't know `bonsai_visualize` exists. |
| **Interaction Style** | Use `AskUserQuestion` for decisions, 2-4 choices, end with "What's next?" | Previously repeated in 13/14 skills. Ensures consistent interaction pattern. |
| **Spec-Driven Workflow** | Use `spec_list`/`registry_query` at start, use `spec_save`/`registry_mutate` after saving, respect spec hierarchy | Previously in 10-11/14 skills. Grounds the agent in the spec-driven methodology. |
| **Proactive Suggestions** | `SuggestSession` triggers, key tips (`specIds`, `prompt`, `reason`), behavioral rules (respect dismissals, limit to 1-3) | Agents need to know the tool exists and when to use it proactively. Parameter details come from the tool schema. |
| **Available Skills** | Compact table of skill name + description, dynamically generated | Enables the agent to recommend relevant next actions without hardcoding suggestions into each skill. |

### What is NOT in General Instructions

| Instruction | Why it stays skill-specific |
|-------------|-----------------------------|
| Code-first analysis ("read code first, present findings") | Only relevant for 7/14 skills (design/creation skills). Would confuse utility skills like `spec-status` or `registry-update`. |
| Progress tracker JSON template | The specific step to highlight as "current" varies per skill. Skills own their progress display. |
| Specific question trees and multi-choice options | Domain logic that defines the skill's workflow. |
| Registry entry schema (type, links, covers) | Varies per skill type. General Instructions says "update the registry"; skills say *how*. |

## Skill Resolution

Skills are resolved from the plugin directory on disk:

```
{plugin_dir}/
  skills/
    {skill_id}/
      SKILL.md          ← loaded by build_context (body for active skill, frontmatter for skills table)
```

### SKILL.md Format

SKILL.md files have YAML frontmatter followed by markdown content:

```markdown
---
name: module-design
description: Design a module-level specification
argument-hint: "[module-path]"
---

# Module Design Specification Generator

You are helping the user create a **Module Design Specification**...
```

The `build_context` function uses SKILL.md in two ways:

1. **Active skill** (the one being run): Reads the file, strips YAML frontmatter, uses the markdown body as skill instructions in section 2.
2. **All skills** (for the skills table): Reads the YAML frontmatter `name` and `description` fields to populate the Available Skills table in section 1.

### Plugin Directory Resolution

Skills are part of the Bonsai application, not the target project. The plugin directory points to the `claude-plugin/` folder in the Bonsai installation:

- `AppConfig.plugin_dir` is set by `load_config()` using the Bonsai repo root (derived from the package location: `backend/app/core/config.py` → `../../../claude-plugin/`)
- This is independent of `project_root`, which is the user's connected project directory

## SKILL.md Cleanup Guide

With General Instructions now handling common behavioral rules, existing SKILL.md files should be cleaned up to remove duplicated boilerplate. The following sections can be **removed** from each skill:

| Boilerplate to remove | Was in | Now handled by |
|-----------------------|--------|----------------|
| "NEVER use Bash, echo, printf, or ANSI escape codes for visual output" | 13/14 skills | General Instructions → Visualization |
| "Use `bonsai_visualize` tool for all structured visual output" | 13/14 skills | General Instructions → Visualization |
| "Use the `AskUserQuestion` tool for every design decision" | 13/14 skills | General Instructions → Interaction Style |
| "Use `spec_list`/`registry_query`" as a first step | 11/14 skills | General Instructions → Spec-Driven Workflow |
| Available visualization types reference (progress-tracker, summary-box, etc.) | 13/14 skills | General Instructions → Visualization |

Each skill should **keep**: its unique task logic, question trees, specific visualization templates (e.g., progress-tracker JSON with the right "current" step), registry entry specifics, and domain-specific instructions.

## File Organization

| File | Responsibility |
|------|---------------|
| `context.py` | `build_context()` function — loads sources, composes prompt |

This is a single-file submodule. No classes — just a pure function with helpers.

### Internal Helpers

`build_context()` uses internal helper functions:

| Helper | Responsibility |
|--------|---------------|
| `_strip_frontmatter(text)` | Removes YAML frontmatter (between `---` delimiters) from a string |
| `_parse_frontmatter(text)` | Extracts simple `key: value` YAML frontmatter into a dict without requiring PyYAML |
| `scan_skill_frontmatter(plugin_dir)` | Scans all `skills/*/SKILL.md`, parses YAML frontmatter, returns sorted list of skill dicts with `id`, `name`, `description`, and optional `icon`, `group`, `requires` |
| `_build_general_instructions(plugin_dir)` | Composes the General Instructions section, including scanning skills/ for the available skills table |
| `_load_skill(skill_id, plugin_dir)` | Reads SKILL.md, strips frontmatter, returns markdown body |
| `_build_specs_section(spec_ids, spec_service)` | Loads specs by ID, formats as titled sections |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| General Instructions section | New always-present section before skill instructions | Consolidates rules duplicated across 13/14 skills. Eliminates ~15-25 lines of boilerplate per skill. Ensures consistent behavior in all sessions including free-form. |
| Section ordering | General → Skill → Project → Specs | General rules set the behavioral foundation first. Skill narrows the task. Project grounds it in a directory. Specs provide domain knowledge last (largest section). |
| Visualization Tool merged into General | Removed standalone "Visualization Tool" section | The visualization tool reference and the anti-pattern rules are logically one topic. Merging eliminates a section boundary and keeps all visualization guidance together. |
| Dynamic skills table | Scan `skills/*/SKILL.md` frontmatter at build time | Avoids hardcoding the skills list. Skills can be added/removed without updating a separate manifest. The scan is cheap (just YAML frontmatter parsing). |
| Skills table: name + description only | No argument-hint in the table | The table helps the agent *recommend* skills. Argument details are the skill's own concern once invoked. Keeps the table compact. |
| Code-first analysis NOT extracted | Stays in individual skill files | Only relevant for design/creation skills (7/14). Including it in general instructions would confuse utility skills that don't analyze code. |
| Framing prompts | Markdown headers and introductory sentences between sections | Raw concatenation loses structure. Framing helps the LLM distinguish between general rules, skill instructions, project info, and spec content. |
| Frontmatter stripping | Remove YAML frontmatter from SKILL.md | Frontmatter is metadata for the plugin system (name, description), not instructions for the agent. Including it would confuse the prompt. |
| Pure function | `build_context()` not a class | No state to manage. Takes inputs, returns a string. Simple to test and compose. |
| Config parameter | Accept `AgentConfig` | Future-proofs for config-dependent context (e.g., include/exclude sections based on permission_mode or other flags). Currently used minimally. |
| Plugin dir from Bonsai root | `plugin_dir` derived from Bonsai installation path, not target project | Skills are part of Bonsai itself (shipped in `claude-plugin/`). Target projects don't contain skill definitions. Derived from package location for robustness. |

## Integration with Agent Module

`service.py._build_context_for()` delegates to `build_context()` from `context.py`:

```python
from app.agent.context import build_context

def _build_context_for(self, task: AgentTask) -> str:
    return build_context(
        spec_ids=task.spec_ids,
        skill_id=task.skill_id,
        session_prompt=task.session_prompt,
        project_root=self._config.project_root,
        config=task.config,
        spec_service=self._spec_service,
        plugin_dir=self._config.plugin_dir,
    )
```

### RPC Layer Change

`agent/run` params include optional `skillId` and `prompt`:

```json
{
  "method": "agent/run",
  "params": {
    "specIds": ["module-agent"],
    "skillId": "module-design",
    "prompt": "Focus on the build_context() helpers.",
    "config": { "model": "claude-opus-4-6", "maxTurns": 25 }
  }
}
```

The `prompt` field is optional. When provided, it becomes the `session_prompt` on the `AgentTask` and is placed inside the "Your Task" section of the system prompt, before the SKILL.md body. This field is also available via the `SuggestSession` tool's `prompt` parameter.

## Context Budget Warnings

`build_context_structured()` returns additional fields for context budget management:

| Field | Type | Description |
|-------|------|-------------|
| `contextMax` | `int` | Model's context window size (from `_FALLBACK` registry) |
| `budgetRatio` | `float` | System prompt tokens / context window (0.0–1.0) |
| `warnings` | `list[str]` | Human-readable warnings when budget exceeds thresholds |

**Thresholds:**
- `> 0.4` (40%): Warning — "System prompt uses X% of context window. Consider removing some specs."
- `> 0.8` (80%): Critical — "Very limited room for conversation."

These are surfaced in the `prepare_agent` and `update_draft` RPC responses so the frontend can display budget indicators in the draft config card.

## Known Limitations

- **Single plugin directory** — only one `plugin_dir` is supported. No merging from multiple plugin sources (e.g., project-local + global `~/.claude/skills/`).
- **No dynamic context updates** — context is built once at session start. If specs or skill files change mid-session, the agent's context is stale until a new session is started.
- **No SKILL.md validation** — assumes well-formed frontmatter. Malformed SKILL.md files may produce unexpected prompt content.
- **Skills table scan cost** — scanning all SKILL.md files at session start adds I/O. With ~14 skills this is negligible, but could matter if the skills directory grows significantly.

## Related Specs

- **Parent:** [Agent Module](README.md)
- **Depends on:** [Spec Module](../spec/README.md) (for `spec_service.get_spec()`)
- **Depends on:** [Core Config](../core/README.md) (for `AppConfig.plugin_dir` — Bonsai installation path)
- **Used by:** `service.py` (calls `build_context()` in `run_task`)
