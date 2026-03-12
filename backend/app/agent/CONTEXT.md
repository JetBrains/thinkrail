# Agent Context — Submodule Specification

> Parent: [Agent Module](README.md) | Status: **Active** | Created: 2026-03-03

## Purpose

The Context submodule is responsible for assembling the full prompt context that feeds an agent session. It gathers content from multiple sources — skill instructions (loaded from plugin SKILL.md files), project metadata (working directory path and configuration), and specification documents (loaded by ID from the registry) — and composes them into a structured system prompt passed to the Claude Agent SDK. It owns the ordering, formatting, framing, and separation of context sections.

## Architecture

**Pattern:** Pipeline — gather → compose.

```
  Inputs
  ┌────────────┐  ┌────────────────┐  ┌─────────────┐  ┌────────────┐
  │ skill_id   │  │ spec_ids[]     │  │ project_root│  │ config     │
  │ (optional) │  │ (from registry)│  │ (Path)      │  │ (AgentCfg) │
  └─────┬──────┘  └───────┬────────┘  └──────┬──────┘  └─────┬──────┘
        │                 │                   │               │
        ▼                 ▼                   ▼               ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │                    build_context()                               │
  │                                                                 │
  │  1. Load skill instructions (SKILL.md)                          │
  │  2. Gather project metadata                                     │
  │  3. Insert visualization tool instructions                      │
  │  4. Load spec content by IDs                                    │
  │  5. Compose with framing prompts                                │
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

**Returns:** A composed system prompt string with framing sections.

**Raises:**
- `FileNotFoundError` — if `skill_id` is provided but SKILL.md does not exist at the expected path
- No error for empty `spec_ids` — returns prompt with skill + project sections only

## Context Sections & Ordering

The system prompt is assembled in this order, with framing text between sections:

### 1. Skill Instructions (if `skill_id` is provided)

```
## Your Task

You are running the "{skill_name}" skill.

{SKILL.md content — full prompt text from the skill file}
```

- **Source:** `{plugin_dir}/skills/{skill_id}/SKILL.md`
- Reads the SKILL.md file, strips the YAML frontmatter (between `---` delimiters), and uses the body as the skill instructions
- If `skill_id` is `None`, this section is omitted entirely (free-form session)

### 2. Project Metadata

```
## Project

Working directory: {project_root}
```

- Always present — every session has a project root
- May be extended in future with additional metadata (e.g., git branch, language, framework)

### 3. Visualization Tool Instructions

```
## Visualization Tool

You have access to the `bonsai_visualize` MCP tool ...
```

- **Always present** — included in both skill-based and free-form sessions
- Describes the tool's available visualization types (progress-tracker, summary-box, comparison, data-table, status-list, diagram)
- Includes anti-patterns (no Bash/ANSI, no ASCII art) to steer the model toward using the tool
- Without this section, the model would not know the `bonsai_visualize` tool exists or when to call it

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

When both `skill_id` is `None` and `spec_ids` is empty, the system prompt contains the project metadata section and the visualization tool instructions. This ensures the agent always knows about `bonsai_visualize`, even in free-form sessions with no skill or specs.

## Skill Resolution

Skills are resolved from the plugin directory on disk:

```
{plugin_dir}/
  skills/
    {skill_id}/
      SKILL.md          ← loaded by build_context
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

The `build_context` function:
1. Reads the file
2. Strips the YAML frontmatter (everything between the first two `---` lines)
3. Uses the remaining markdown body as skill instructions

### Plugin Directory Resolution

Skills are part of the Bonsai application, not the target project. The plugin directory points to the `claude-plugin/` folder in the Bonsai installation:

- `AppConfig.plugin_dir` is set by `load_config()` using the Bonsai repo root (derived from the package location: `backend/app/core/config.py` → `../../../claude-plugin/`)
- This is independent of `project_root`, which is the user's connected project directory

## File Organization

| File | Responsibility |
|------|---------------|
| `context.py` | `build_context()` function — loads sources, composes prompt |

This is a single-file submodule. No classes — just a pure function with helpers.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Section ordering | Skill → Project → Visualization → Specs | Skill instructions set the agent's role/framing first. Project grounds it in a directory. Visualization instructions ensure the model knows about `bonsai_visualize` in all sessions. Specs provide domain knowledge last (largest section, furthest from the start). |
| Framing prompts | Markdown headers and introductory sentences between sections | Raw concatenation loses structure. Framing helps the LLM distinguish between skill instructions, project info, and spec content. |
| Frontmatter stripping | Remove YAML frontmatter from SKILL.md | Frontmatter is metadata for the plugin system (name, description), not instructions for the agent. Including it would confuse the prompt. |
| Pure function | `build_context()` not a class | No state to manage. Takes inputs, returns a string. Simple to test and compose. |
| Config parameter | Accept `AgentConfig` | Future-proofs for config-dependent context (e.g., include/exclude sections based on permission_mode or other flags). Currently used minimally. |
| Plugin dir from Bonsai root | `plugin_dir` derived from Bonsai installation path, not target project | Skills are part of Bonsai itself (shipped in `claude-plugin/`). Target projects don't contain skill definitions. Derived from package location for robustness. |

## Integration with Agent Module

### Current State (before implementation)

`service.py._build_context()` loads specs only:

```python
def _build_context(self, spec_ids: list[str]) -> str:
    parts = []
    for sid in spec_ids:
        detail = self._spec_service.get_spec(sid)
        parts.append(f"# {detail.title}\n\n{detail.content}")
    return "\n\n---\n\n".join(parts)
```

### Target State (after implementation)

`service.py.run_task()` calls `build_context()` from `context.py`:

```python
from app.agent.context import build_context

async def run_task(self, spec_ids, config, notify, skill_id=None):
    task = self._tracker.create_task(spec_ids, config)
    spec_context = build_context(
        spec_ids=spec_ids,
        skill_id=skill_id,
        project_root=self._config.project_root,
        config=config,
        spec_service=self._spec_service,
        plugin_dir=self._config.plugin_dir,
    )
    # ... launch runner with spec_context as system_prompt
```

### RPC Layer Change

`agent/run` params must include optional `skillId`:

```json
{
  "method": "agent/run",
  "params": {
    "specIds": ["module-agent"],
    "skillId": "module-design",
    "config": { "model": "claude-opus-4-6", "maxTurns": 25 }
  }
}
```

## Known Limitations

- **No context size management** — no token counting or truncation. If specs are large, the system prompt may exceed model context limits.
- **Single plugin directory** — only one `plugin_dir` is supported. No merging from multiple plugin sources (e.g., project-local + global `~/.claude/skills/`).
- **No dynamic context updates** — context is built once at session start. If specs or skill files change mid-session, the agent's context is stale until a new session is started.
- **No SKILL.md validation** — assumes well-formed frontmatter. Malformed SKILL.md files may produce unexpected prompt content.

## Related Specs

- **Parent:** [Agent Module](README.md)
- **Depends on:** [Spec Module](../spec/README.md) (for `spec_service.get_spec()`)
- **Depends on:** [Core Config](../core/README.md) (for `AppConfig.plugin_dir` — Bonsai installation path)
- **Used by:** `service.py` (calls `build_context()` in `run_task`)
