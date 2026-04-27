---
id: task-migration-tool
type: task-spec
status: done
title: 'Implement migration tool: registry.json → frontmatter + index.db'
depends-on:
- task-frontmatter
- task-index
implements:
- module-spec
covers:
- backend/app/spec/migrate.py
tags:
- high
- new-feature
- frontmatter-sqlite
---
# Implement migration tool: registry.json → frontmatter + index.db

One-time migration that reads `registry.json`, injects YAML frontmatter into all existing spec files, builds `index.db`, and archives the registry. Can run as a CLI command (`bonsai migrate-registry`) or automatically on first startup when `registry.json` exists but `index.db` does not.

**Design reference:** [Frontmatter + SQLite Index Design — §Migration Strategy](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#migration-strategy)

## Context

The project currently has ~90 specs tracked in `.bonsai/registry.json`. Each spec file is plain Markdown with no frontmatter. The migration must:
1. Read all entries and links from `registry.json`
2. Inject frontmatter into each spec file (preserving existing content)
3. Build `index.db` from the newly-frontmatted files
4. Archive `registry.json` → `registry.json.bak`

The migration is idempotent — re-running it skips files that already have frontmatter.

## Plan

1. **Implement `migrate_registry(project_root: Path) → MigrationResult`**
   - Read `registry.json` → parse entries and links
   - For each entry:
     a. Read the spec file at `entry.path`
     b. Check if file already has frontmatter (skip if so — idempotent)
     c. Build frontmatter dict from registry entry fields:
        - `id`, `type`, `status`, `title` from entry
        - `covers`, `tags` from entry
        - Scan links array for outgoing links from this spec → add `parent`, `depends-on`, `references`, `implements` fields
     d. Serialize frontmatter + existing content via `serialize_frontmatter()`
     e. Write updated file atomically
   - Track stats: files migrated, files skipped (already had frontmatter), files missing, errors

2. **Implement link resolution for frontmatter**
   - For each spec, find all outgoing links from the `links` array:
     - `links[].from == spec_id && type == "parent"` → `parent: target_id`
     - `links[].from == spec_id && type == "depends-on"` → `depends-on: [target_ids]`
     - `links[].from == spec_id && type == "references"` → `references: [target_ids]`
     - `links[].from == spec_id && type == "implements"` → `implements: [target_ids]`
   - Group by link type, flatten to lists

3. **Build index.db** — After all files are migrated, call `SpecIndex.rebuild()` to scan and index everything

4. **Archive registry.json** — Rename to `.bonsai/registry.json.bak` (preserve for safety/rollback)

5. **Update `.gitignore`** — Ensure `.bonsai/index.db` is listed

6. **Implement auto-detection on startup**
   - In `rpc/server.py` startup or `SpecIndex.ensure_ready()`:
     - If `registry.json` exists AND `index.db` does not → run migration automatically
     - If both exist → skip (already migrated, `index.db` rebuilt from frontmatter)
     - If neither exists → normal first-run (empty index)

7. **Error handling and rollback**
   - If migration fails partway: `registry.json.bak` is untouched, files already migrated have frontmatter (harmless — old system ignores it)
   - Re-running completes remaining files
   - Log clear progress: `Migrating spec {n}/{total}: {path}`

8. **Unit tests** — Cover:
   - Full migration of test registry with entries + links
   - Idempotent: re-run skips already-migrated files
   - Missing file handling (entry in registry, file deleted)
   - Link resolution (parent, depends-on, references, implements)
   - Archive registry.json → .bak
   - Auto-detection logic

## Files to modify

- `backend/app/spec/migrate.py` — **NEW** — migration logic
- `backend/app/rpc/server.py` — Add auto-detection on startup
- `backend/tests/spec/test_migrate.py` — **NEW** — unit tests

## Definition of done

- Migration reads `registry.json`, injects frontmatter into all spec files
- Links from registry are correctly mapped to frontmatter fields
- `index.db` is built from migrated files
- `registry.json` archived as `.bak`
- Idempotent — safe to re-run
- Auto-detection on startup works
- Unit tests pass

## Style Notes

Follow conventions in `.claude/CLAUDE.md § Code Style — Python Backend`:
- `MigrationResult` as `@dataclass` (internal container with stats)
- Clear progress logging: `logger.info("Migrating spec %d/%d: %s", n, total, path)`
- Graceful handling of missing files — log warning, continue, don't crash
- Class-based tests: `class TestMigrateRegistry:`, `class TestAutoDetection:`

**Priority:** High — needed before any project can use the new architecture
**Depends on:** task-frontmatter, task-index (uses both to write frontmatter and build index)
**Started:** 2026-04-16
