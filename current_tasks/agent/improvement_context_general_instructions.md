# Add General Instructions section to context.py

**Status:** Active
**Priority:** High
**Spec reference:** `backend/app/agent/CONTEXT.md`

The context assembly pipeline currently has no "General Instructions" section — behavioral rules for visualization, interaction, spec workflow, proactive suggestions, and available skills are duplicated across individual SKILL.md files. This task adds a new always-present section at the top of the system prompt per the redesigned CONTEXT.md spec.

## Current state

`build_context()` assembles: Skill → Project → Viz Tool → Specs.
The "Viz Tool" section is imported from `VIZ_INSTRUCTIONS` in `visualization.py` — a static string.
There is no skills table, no interaction style guidance, no spec workflow rules, and no proactive suggestions guidance in the system prompt.

## Target state

`build_context()` assembles: **General Instructions** → Skill → Project → Specs.
The General Instructions section is always present (including free-form sessions) and includes five subsections: Visualization, Interaction Style, Spec-Driven Workflow, Proactive Suggestions, Available Skills.

## Plan

### 1. Add `_scan_skill_frontmatter()` helper

New function in `context.py`:

```python
def _scan_skill_frontmatter(plugin_dir: Path) -> list[tuple[str, str]]:
    """Scan all skills/*/SKILL.md, parse YAML frontmatter, return (name, description) tuples."""
```

- Glob `{plugin_dir}/skills/*/SKILL.md`
- For each file, extract `name` and `description` from YAML frontmatter
- Return sorted list of `(name, description)` tuples
- Gracefully skip files with malformed frontmatter (log warning, don't crash)

### 2. Add `_build_general_instructions()` helper

New function in `context.py`:

```python
def _build_general_instructions(plugin_dir: Path) -> str:
    """Compose the General Instructions section with all subsections."""
```

Assembles the five subsections in order as a single markdown string:
1. **Visualization** — `bonsai_visualize` tool reference, available types, anti-patterns (content matches current `VIZ_INSTRUCTIONS` but nested under General Instructions header)
2. **Interaction Style** — `AskUserQuestion` rules, 2-4 choices, end with next actions
3. **Spec-Driven Workflow** — read registry, update after saving, respect hierarchy
4. **Proactive Suggestions** — `SuggestSession` triggers, include specIds, respect dismissals
5. **Available Skills** — call `_scan_skill_frontmatter()`, format as markdown table

The content for subsections 1-4 is a string template in the function (not loaded from disk — these are short, stable behavioral rules).

### 3. Extract `_build_specs_section()` helper

Refactor the inline specs logic into its own function for readability:

```python
def _build_specs_section(spec_ids: list[str], spec_service: SpecService) -> str:
    """Load specs by ID, format as titled sections separated by ---."""
```

### 4. Update `build_context()` pipeline

- Remove the `VIZ_INSTRUCTIONS` import from `app.agent.tools.visualization`
- Reorder section assembly:
  1. `_build_general_instructions(plugin_dir)` — always
  2. Skill instructions (existing `_load_skill()`) — if `skill_id`
  3. Project metadata — always
  4. `_build_specs_section()` — if `spec_ids`
- Update docstring to reflect new ordering

### 5. Update tests

- Add test for `_scan_skill_frontmatter()` — mock a temp skills directory with 2-3 SKILL.md files
- Add test for `_build_general_instructions()` — verify all 5 subsections present, skills table populated
- Update existing `build_context()` tests — assert General Instructions appears first, Visualization Tool section no longer standalone
- Test free-form session (no skill, no specs) — assert General Instructions + Project present

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/context.py` | Add `_scan_skill_frontmatter()`, `_build_general_instructions()`, `_build_specs_section()` helpers; reorder `build_context()` pipeline; remove `VIZ_INSTRUCTIONS` import |
| `backend/tests/agent/test_context.py` | Add/update tests for new helpers and reordered pipeline |

## Files NOT modified

| File | Why |
|------|-----|
| `visualization.py` | `VIZ_INSTRUCTIONS` stays (used by the MCP tool description); only the import in `context.py` is removed |
| SKILL.md files | Boilerplate cleanup is a separate task |
| `service.py` | No signature change — `build_context()` API is unchanged |

## Definition of done

- `build_context()` returns prompt with General Instructions as the first section
- General Instructions contains all 5 subsections (Visualization, Interaction Style, Spec-Driven Workflow, Proactive Suggestions, Available Skills)
- Available Skills table is dynamically generated from SKILL.md frontmatter
- Free-form sessions (no skill, no specs) include General Instructions + Project
- Existing tests updated and passing (`uv run pytest`)
- `VIZ_INSTRUCTIONS` no longer imported by `context.py`

**Priority:** High
**Spec:** [CONTEXT.md](../../backend/app/agent/CONTEXT.md)
**Started:** 2026-03-13
