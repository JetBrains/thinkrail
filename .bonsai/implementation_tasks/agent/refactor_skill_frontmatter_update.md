---
id: task-skill-updates
type: task-spec
status: done
title: Update all 18 SKILL.md files for frontmatter + new MCP tools
depends-on:
- task-mcp-tools-rewrite
covers:
- claude-plugin/skills/
tags:
- high
- refactor
- frontmatter-sqlite
---
# Update all 18 SKILL.md files for frontmatter + new MCP tools

Update every skill's instructions to use the new 3-tool MCP API (`spec_search`, `spec_links`, `spec_delete`) and direct file writes with YAML frontmatter instead of the old 7-tool API. Changes follow 4 patterns documented in the design doc.

**Design reference:** [Frontmatter + SQLite Index Design — §Skill Instruction Changes](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#skill-instruction-changes)

## Context

All 18 skills in `claude-plugin/skills/*/SKILL.md` currently reference the old tool names (`spec_list`, `spec_get`, `spec_save`, `spec_delete`, `spec_links`, `registry_query`, `registry_mutate`). After the MCP tools rewrite, these instructions must be updated so agents:
- Use `spec_search` instead of `spec_list` / `registry_query`
- Use `Read` instead of `spec_get`
- Use `Write`/`Edit` with frontmatter instead of `spec_save` / `registry_mutate`
- Use `spec_delete` for deletions (same name, enhanced behavior)

Each skill also needs a **Frontmatter Schema** reference section so agents write valid frontmatter when creating specs.

## Plan

### Pattern 1: Read-Only Skills (query index, display results)

**Skills:** `spec-status`, `spec-next`, `cli-progress`, `visualization`

**Changes:**
- Replace `spec_list` / `registry_query` calls → `spec_search`
- Replace `spec_get` calls → `Read` tool (agent has the path from `spec_search`)
- Replace `spec_links` → `spec_links` (same name, updated parameter names: `direction` values change from `both/outgoing/incoming` to `children/parents/dependencies/dependents/all`)

### Pattern 2: Spec-Creating Skills (create new spec + link it)

**Skills:** `architecture-design`, `module-design`, `submodule-design`, `task-spec`, `goal-and-requirements`, `spec-init`, `spec-from-code`

**Changes:**
- Replace `spec_save` + `registry_mutate` → `Write` tool with YAML frontmatter
- Add frontmatter schema reference section to each skill
- Remove instructions about registry entry creation / link addition
- Add instructions: "Write spec file with frontmatter, watcher validates and indexes"
- Example template for each skill:
  ```markdown
  Use `Write` to create the spec file with YAML frontmatter:
  ---
  id: <generated-id>
  type: <spec-type>
  status: draft
  parent: <parent-spec-id>
  depends-on:
    - <dependency-id>
  tags:
    - <tag>
  covers:
    - <source-path>
  ---
  <Markdown content>
  ```

### Pattern 3: Spec-Modifying Skills (update status, fix links)

**Skills:** `spec-review`, `spec-lint`

**Changes:**
- Replace `registry_mutate` status/link updates → `Edit` tool (edit frontmatter in-place)
- Add instructions for editing frontmatter fields directly in spec files
- Example: "Use `Edit` to change `status: draft` to `status: active` in the spec file's frontmatter"

### Pattern 4: Ticket Skills (draft mode)

**Skills:** `ticket-specify`, `ticket-describe`, `ticket-plan`, `ticket-execute`

**Changes:**
- `ticket-specify`: Draft mode must work with direct file writes. Options:
  - Agent writes to a staging directory (e.g., `.bonsai/drafts/{ticket-id}/`)
  - Or agent writes spec files with `status: draft` and applies them on approval
  - Update instructions to reflect whichever approach is chosen
- `ticket-describe`, `ticket-plan`, `ticket-execute`: Replace `spec_list`/`registry_query` → `spec_search`, `spec_get` → `Read`

### Cross-cutting: Frontmatter Schema Section

Add to every spec-creating skill (Pattern 2):

```markdown
## Frontmatter Format

When creating or editing specs, use YAML frontmatter at the top of the file:

Required fields:
- `id` — unique identifier (e.g. `module-auth`, `task-fix-login`)
- `type` — one of: goal-and-requirements, architecture-design, module-design, submodule-design, task-spec

Optional fields:
- `status` — draft (default), active, stale, done, deprecated
- `title` — display name (defaults to first # heading)
- `parent` — spec ID of the parent
- `depends-on` — list of spec IDs this depends on
- `references` — list of spec IDs this references
- `implements` — list of spec IDs this implements
- `covers` — list of source paths documented
- `tags` — list of labels
```

## Skill inventory and pattern assignment

| Skill | Pattern | Key Changes |
|-------|---------|-------------|
| `architecture-design` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `cli-progress` | 1 (Read-Only) | `spec_list` → `spec_search` |
| `goal-and-requirements` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `module-design` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `new-project` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `spec-from-code` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `spec-init` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `spec-lint` | 3 (Modifying) | `registry_mutate` → `Edit` frontmatter |
| `spec-next` | 1 (Read-Only) | `spec_list` → `spec_search` |
| `spec-review` | 3 (Modifying) | `registry_mutate` → `Edit` frontmatter |
| `spec-status` | 1 (Read-Only) | `spec_list`/`registry_query` → `spec_search` |
| `submodule-design` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `task-spec` | 2 (Creating) | `spec_save` → `Write` + frontmatter |
| `ticket-describe` | 4 (Ticket) | `spec_list` → `spec_search` |
| `ticket-execute` | 4 (Ticket) | `spec_list` → `spec_search` |
| `ticket-plan` | 4 (Ticket) | `spec_list` → `spec_search`, `spec_get` → `Read` |
| `ticket-specify` | 4 (Ticket) | Draft mode redesign |
| `visualization` | 1 (Read-Only) | No spec tool references (utility skill) |

## Files to modify

- `claude-plugin/skills/architecture-design/SKILL.md`
- `claude-plugin/skills/cli-progress/SKILL.md`
- `claude-plugin/skills/goal-and-requirements/SKILL.md`
- `claude-plugin/skills/module-design/SKILL.md`
- `claude-plugin/skills/new-project/SKILL.md`
- `claude-plugin/skills/spec-from-code/SKILL.md`
- `claude-plugin/skills/spec-init/SKILL.md`
- `claude-plugin/skills/spec-lint/SKILL.md`
- `claude-plugin/skills/spec-next/SKILL.md`
- `claude-plugin/skills/spec-review/SKILL.md`
- `claude-plugin/skills/spec-status/SKILL.md`
- `claude-plugin/skills/submodule-design/SKILL.md`
- `claude-plugin/skills/task-spec/SKILL.md`
- `claude-plugin/skills/ticket-describe/SKILL.md`
- `claude-plugin/skills/ticket-execute/SKILL.md`
- `claude-plugin/skills/ticket-plan/SKILL.md`
- `claude-plugin/skills/ticket-specify/SKILL.md`
- `claude-plugin/skills/visualization/SKILL.md`

## Definition of done

- All 18 SKILL.md files updated
- No references to old tool names (`spec_list`, `spec_get`, `spec_save`, `registry_query`, `registry_mutate`)
- Spec-creating skills include frontmatter schema reference
- Read-only skills use `spec_search` + `Read`
- Modifying skills use `Edit` on frontmatter
- Ticket skills handle draft mode appropriately
- Grep for old tool names across all SKILL.md files returns zero hits

**Priority:** High — agents will break without updated instructions
**Depends on:** task-mcp-tools-rewrite (new tool names must exist first)
**Started:** 2026-04-16
