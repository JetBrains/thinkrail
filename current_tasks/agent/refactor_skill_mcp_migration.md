# Refactor skills: replace raw file I/O with bonsai-specs MCP tools

All 13 SKILL.md files in `claude-plugin/skills/` instruct the agent to read `.specs/registry.json` via the Read tool, write registry entries via the Edit tool, read spec files via Read, and create new spec files via Write. These instructions must be updated to use the new `bonsai-specs` MCP tools (`spec_list`, `spec_get`, `spec_save`, `spec_links`, `registry_query`, `registry_mutate`) instead.

**What stays the same:** Skills can still use the `Edit` tool to make targeted modifications to existing spec files (e.g., updating a DESIGN_DOC.md index, editing a section). Only raw registry I/O, spec file reads, and new spec file creation are migrated.

## Migration rules

| Old pattern | New tool | Notes |
|---|---|---|
| `Read .specs/registry.json` to get spec list/metadata | `spec_list` | Filter by type, status, tag |
| `Read .specs/registry.json` for coverage/aggregate queries | `registry_query` | Filter by type, status, tag, covers, ids |
| `Read .specs/registry.json` to get links | `spec_links` | Filter by ids, link_type, direction |
| `Read <spec-file>` to get spec content | `spec_get` | Returns content + metadata + links |
| `Write <new-spec-file>` to create a new spec | `spec_save` | Atomic: writes file + adds registry entry |
| `Edit .specs/registry.json` to add/remove/update entries or links | `registry_mutate` | Batch: add_entries, update_entries, remove_entries, add_links, remove_links |
| `Edit <existing-spec-file>` to modify content | **Keep using Edit** | No change — targeted edits stay as-is |

## Plan

### 1. Read-only skills (registry reads only, no writes)

These skills only read the registry and spec/task files for data gathering. Replace all `Read .specs/registry.json` and `scan current_tasks/` instructions with the appropriate MCP tool.

**cli-progress/SKILL.md**
- Line 14: `Read .specs/registry.json and scan current_tasks/ to determine:` → Use `registry_query` to get specs by type/status and `spec_list` with `type: "task-spec"` for task counts

**spec-status/SKILL.md**
- Line 14: `Read .specs/registry.json to get the list of specs...Then scan current_tasks/**/*.md for task statuses.` → Use `registry_query` for spec metadata and `spec_list` with `type: "task-spec"` for tasks
- Line 74: `Read registry.json + task files` → Update Key Principles to reference MCP tools

**spec-next/SKILL.md**
- Line 14: `Read .specs/registry.json for specs (type, status, covers, paths). Scan current_tasks/**/*.md for task statuses. Identify coverage gaps by comparing registered covers entries against source directories.` → Use `registry_query` for specs with covers data and `spec_list` with `type: "task-spec"` for task statuses

**visualisation/SKILL.md**
- Line 14: `read .specs/registry.json and current_tasks/ to gather data, then visualize` → Use `registry_query` and `spec_list` with `type: "task-spec"`
- Lines 22-23: `Read .specs/registry.json and scan current_tasks/ for task status. Compute:` → Same replacement

### 2. Read + write skills (registry reads + registry writes after saving)

These skills read specs for context and update the registry after creating/saving a spec file.

**goal-and-requirements/SKILL.md**
- Line 247: `Write GOAL&REQUIREMENTS.md` → Use `spec_save` with `type: "goal-and-requirements"`, content, status, tags
- Lines 253-255: `Update .specs/registry.json...Add entry...add references links` → Remove this section entirely — `spec_save` handles the registry entry atomically. Add a follow-up `registry_mutate` call only for the `references` links to module specs

**architecture-design/SKILL.md**
- Line 128: `Generate DESIGN_DOC.md with:` → Use `spec_save` with `type: "architecture-design"`, content, status
- Lines 169-172: `After saving, update .specs/registry.json...Add entry...Add parent links` → Remove the "add entry" instruction (handled by `spec_save`). Keep only a `registry_mutate` call for adding `parent` links from module READMEs and README.md

**module-design/SKILL.md**
- Line 35: `Check: Does DESIGN_DOC.md exist and reference this module?` → Use `spec_list` with `type: "architecture-design"` to check existence, then `spec_get` to read content
- Line 125: `Generate README.md with:` → Use `spec_save` with `type: "module-design"`, content, status, covers
- Lines 144-148: `After saving, update .specs/registry.json...` → Remove "add entry" (handled by `spec_save`). Use `registry_mutate` for `parent` links. Keep `Edit` instruction for updating DESIGN_DOC.md index

**submodule-design/SKILL.md**
- Line 13: `Check: Does the parent module have a README.md?` → Use `spec_list` with `type: "module-design"` or `registry_query` with covers filter to check
- Line 62: `Generate README.md with:` → Use `spec_save` with `type: "submodule-design"`, content, status, covers
- Lines 80-83: `After saving, update .specs/registry.json...` → Remove "add entry" (handled by `spec_save`). Use `registry_mutate` for `parent` link. Keep `Edit` instruction for updating parent module's Module Index

**task-spec/SKILL.md**
- Line 121: `Check for existing module specs — read them for context` → Use `spec_list` to enumerate, `spec_get` to read module specs for context
- Line 122: `Check current_tasks/ for overlapping tasks` → Use `spec_list` with `type: "task-spec"` to find existing tasks
- Line 90: `Generate current_tasks/{module_path}/{type}_{name}.md` → Use `spec_save` with `type: "task-spec"`, content, status, tags
- Lines 126-130: `After saving, update .specs/registry.json...` → Remove "add entry" (handled by `spec_save`). Use `registry_mutate` for `implements` and `depends-on` links

**spec-init/SKILL.md**
- Lines 47-56: `Create .specs/registry.json with this initial structure` → Keep as Write (bootstrapping — registry doesn't exist yet, MCP tools require it)
- Line 112-113: `Create a minimal README.md...Create a minimal DESIGN_DOC.md skeleton` → Use `spec_save` for each
- Line 123: `Add all created specs to .specs/registry.json` → Use `registry_mutate` to batch-add entries and links

**spec-from-code/SKILL.md**
- Line 13: `read .specs/registry.json for existing specs and their covers entries` → Use `registry_query` with `include_links: true`
- Lines 69-117: `generate a DESIGN_DOC.md skeleton` → Use `spec_save` with `type: "architecture-design"`, status `"draft"`
- Lines 121-152: `generate a README.md` for each module → Use `spec_save` with `type: "module-design"`, status `"draft"`
- Line 156: `Add all generated specs to .specs/registry.json with status "draft"` → Remove — already handled by `spec_save` calls above

### 3. Read + lint/fix skills (read registry + optional auto-fix writes)

**spec-lint/SKILL.md**
- Line 15: `Read .specs/registry.json for the full spec list and links. For each spec, read the first ~4KB...Validate that all link from/to IDs reference existing specs.` → Use `spec_list` for spec list, `spec_links` for link validation, `spec_get` to read individual specs
- Lines 61-64: `Register unregistered specs / Update stale registry entries / Remove broken links from registry` → Use `registry_mutate` for all fix operations

**spec-review/SKILL.md**
- Line 13: `read .specs/registry.json for the list of specs and their metadata` → Use `spec_list` or `registry_query`
- Line 17: `Read the specifications at the path provided` → Use `spec_get` to read spec content
- Lines 98-100: `After reviewing, update .specs/registry.json: Update the status...Update the updated timestamp` → Use `registry_mutate` with `update_entries`

## Files to modify

| File | Change |
|------|--------|
| `claude-plugin/skills/cli-progress/SKILL.md` | Replace registry read instructions |
| `claude-plugin/skills/spec-status/SKILL.md` | Replace registry read instructions |
| `claude-plugin/skills/spec-next/SKILL.md` | Replace registry read instructions |
| `claude-plugin/skills/visualisation/SKILL.md` | Replace registry read instructions |
| `claude-plugin/skills/goal-and-requirements/SKILL.md` | Replace Write + registry update with `spec_save` + `registry_mutate` |
| `claude-plugin/skills/architecture-design/SKILL.md` | Replace Write + registry update with `spec_save` + `registry_mutate` |
| `claude-plugin/skills/module-design/SKILL.md` | Replace Read + Write + registry update with `spec_get` + `spec_save` + `registry_mutate` |
| `claude-plugin/skills/submodule-design/SKILL.md` | Replace Read + Write + registry update with `spec_get` + `spec_save` + `registry_mutate` |
| `claude-plugin/skills/task-spec/SKILL.md` | Replace Read + Write + registry update with `spec_list` + `spec_get` + `spec_save` + `registry_mutate` |
| `claude-plugin/skills/spec-init/SKILL.md` | Replace skeleton Write + registry add with `spec_save` + `registry_mutate`; keep initial registry.json Write |
| `claude-plugin/skills/spec-from-code/SKILL.md` | Replace Read + Write + registry add with `registry_query` + `spec_save` |
| `claude-plugin/skills/spec-lint/SKILL.md` | Replace Read + auto-fix Edit with `spec_list` + `spec_links` + `spec_get` + `registry_mutate` |
| `claude-plugin/skills/spec-review/SKILL.md` | Replace Read + status update with `spec_list` + `spec_get` + `registry_mutate` |

## Definition of done

- No SKILL.md references `Read` on `.specs/registry.json` — all replaced with MCP tool calls
- No SKILL.md uses `Write` to create new spec files — all replaced with `spec_save`
- No SKILL.md uses `Edit` on `.specs/registry.json` — all replaced with `registry_mutate`
- `Edit` on existing spec files (e.g., updating DESIGN_DOC.md index) is preserved unchanged
- Each SKILL.md references the correct MCP tool names
- Reviewed by user

**Priority:** High
**Type:** Refactor
**Depends on:** `feature_specs_mcp_tools` (MCP tools must be implemented first)
**Started:** 2026-03-16
