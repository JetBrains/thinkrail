# Remove duplicated boilerplate from SKILL.md files

**Status:** Active
**Priority:** Medium
**Spec reference:** `backend/app/agent/CONTEXT.md` (SKILL.md Cleanup Guide section)
**Depends on:** `improvement_context_general_instructions` (General Instructions must be implemented first)

With the General Instructions section now always present in the system prompt, each SKILL.md file carries ~5-10 lines of duplicated behavioral rules that are redundant. This task removes that boilerplate from all 14 skill files, leaving them focused on their task-specific logic.

## What to remove

Per the CONTEXT.md Cleanup Guide, the following patterns should be removed from each skill:

| Pattern | Example wording | Found in |
|---------|----------------|----------|
| Viz tool anti-patterns | "NEVER use Bash, echo, printf, or ANSI escape codes for visual output" | 13/14 skills |
| Viz tool mandate | "Use `bonsai_visualize` tool for all structured visual output" | 13/14 skills |
| AskUserQuestion mandate | "Use the `AskUserQuestion` tool for every design decision" | 7/14 skills |
| Registry read instruction | "Read `.specs/registry.json`" as a prerequisite step | 6/14 skills |
| Available vis types listing | "progress-tracker, summary-box, comparison, data-table, status-list, diagram" (as standalone reference) | 3/14 skills |

**All 14 skills** have a dedicated `## IMPORTANT: Interaction Style` or `## IMPORTANT: Visualization Rules` section near the top that contains most of this boilerplate.

## What to keep

Each skill should retain:
- Its unique task logic, question trees, and step-by-step workflow
- Specific `bonsai_visualize` templates (e.g., progress-tracker JSON with the right "current" step)
- Registry entry specifics (type, links, covers) — the *how* of registry updates
- Domain-specific instructions and constraints
- Code-first analysis instructions (7 design skills)

## Plan

### 1. Remove `## IMPORTANT` boilerplate section from each skill

Each of the 14 skills has one of these sections near the top:
- `## IMPORTANT: Interaction Style` — in architecture-design, cli-progress, goal-and-requirements, module-design, registry-update, submodule-design, task-spec
- `## IMPORTANT: Visualization Rules` — in spec-from-code, spec-init, spec-lint, spec-next, spec-review, spec-status
- `## IMPORTANT: Rules` — in visualization

**Action:** Remove the entire section. If it contains skill-specific rules mixed in (e.g., registry-update's "Always show a preview" or "Validate the registry"), keep those and move them into the skill's main workflow section.

### 2. Remove inline registry-read instructions

Some skills have "Read `.specs/registry.json`" as a standalone step in their workflow (not in the IMPORTANT section). This is now handled by General Instructions → Spec-Driven Workflow.

**Action:** Remove the standalone instruction. Keep any skill-specific registry *usage* (e.g., "check for overlapping tasks" in task-spec).

### 3. Verify each skill still reads correctly

After removal, read each file top-to-bottom to ensure:
- The flow is coherent without the removed section
- No dangling references to the removed content
- The skill starts with its purpose/title, then goes straight into its workflow

## Files to modify

| Skill | File | Est. lines removed |
|-------|------|--------------------|
| architecture-design | `claude-plugin/skills/architecture-design/SKILL.md` | ~9 |
| cli-progress | `claude-plugin/skills/cli-progress/SKILL.md` | ~7 |
| goal-and-requirements | `claude-plugin/skills/goal-and-requirements/SKILL.md` | ~8 |
| module-design | `claude-plugin/skills/module-design/SKILL.md` | ~9 |
| registry-update | `claude-plugin/skills/registry-update/SKILL.md` | ~3 (keep specific rules) |
| spec-from-code | `claude-plugin/skills/spec-from-code/SKILL.md` | ~5 |
| spec-init | `claude-plugin/skills/spec-init/SKILL.md` | ~4 |
| spec-lint | `claude-plugin/skills/spec-lint/SKILL.md` | ~3 |
| spec-next | `claude-plugin/skills/spec-next/SKILL.md` | ~3 |
| spec-review | `claude-plugin/skills/spec-review/SKILL.md` | ~4 |
| spec-status | `claude-plugin/skills/spec-status/SKILL.md` | ~3 |
| submodule-design | `claude-plugin/skills/submodule-design/SKILL.md` | ~10 |
| task-spec | `claude-plugin/skills/task-spec/SKILL.md` | ~9 |
| visualization | `claude-plugin/skills/visualization/SKILL.md` | ~7 |

**Total:** ~84 lines of boilerplate removed across 14 files.

## Definition of done

- All 14 SKILL.md files have their `## IMPORTANT` boilerplate section removed
- No skill-specific rules are lost (moved to appropriate location within the skill if mixed in)
- Each skill file reads coherently without the removed content
- Inline registry-read instructions removed where redundant
- General Instructions implementation is deployed (dependency)

**Priority:** Medium
**Spec:** [CONTEXT.md](../../backend/app/agent/CONTEXT.md) — SKILL.md Cleanup Guide
**Started:** 2026-03-13
