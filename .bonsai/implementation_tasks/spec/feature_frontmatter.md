---
id: task-frontmatter
type: task-spec
status: done
title: 'Implement frontmatter.py: YAML frontmatter parsing and serialization'
implements:
- module-spec
covers:
- backend/app/spec/frontmatter.py
tags:
- critical
- new-feature
- frontmatter-sqlite
---
# Implement frontmatter.py: YAML frontmatter parsing and serialization

New file — the lowest-level building block for the Frontmatter + SQLite Index architecture. Provides pure functions to parse YAML frontmatter from Markdown files and serialize metadata back into frontmatter format. No external dependencies beyond a YAML library.

**Design reference:** [Frontmatter + SQLite Index Design — §Frontmatter Schema](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#frontmatter-schema) and [§Write Flow](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#write-flow)

## Context

Currently, spec metadata lives in `registry.json` and spec files are "dumb" Markdown. This module makes each spec file self-describing by embedding metadata as YAML frontmatter (delimited by `---`). The frontmatter becomes the **sole source of truth** — the SQLite index (task 2) is rebuilt from it.

## Plan

1. **Choose YAML library** — Use `PyYAML` (`yaml.safe_load` / `yaml.safe_dump`). It's already a transitive dependency. If `ruamel.yaml` is needed later for comment preservation, that's a future enhancement.

2. **Implement `parse_frontmatter(text: str) → tuple[dict, str]`**
   - Split on `---` delimiters (first two occurrences at line boundaries)
   - Parse YAML block between delimiters via `yaml.safe_load`
   - Return `(frontmatter_dict, body)` — body is everything after the closing `---`
   - If no valid frontmatter delimiters found, return `({}, full_text)`
   - If YAML is malformed, raise `FrontmatterError` with the parse error details

3. **Implement `serialize_frontmatter(meta: dict, body: str) → str`**
   - Build YAML string from `meta` dict via `yaml.safe_dump(default_flow_style=False, sort_keys=False)`
   - Combine as `---\n{yaml}\n---\n{body}`
   - Preserve key ordering: `id`, `type`, `status`, `title`, `parent`, `depends-on`, `references`, `implements`, `covers`, `tags`, then any custom keys
   - Ensure no trailing whitespace in YAML output

4. **Implement `update_frontmatter(text: str, updates: dict) → str`**
   - Parse existing frontmatter + body
   - Merge `updates` into frontmatter dict (overwrite matching keys, add new keys)
   - Re-serialize with updated frontmatter + original body
   - Preserves body content exactly (no whitespace changes)

5. **Implement `extract_links(meta: dict) → list[tuple[str, str]]`**
   - Extract link fields from frontmatter: `parent`, `depends-on`, `references`, `implements`
   - Return list of `(link_type, target_id)` tuples
   - `parent: X` → `[("parent", "X")]`
   - `depends-on: [X, Y]` → `[("depends-on", "X"), ("depends-on", "Y")]`
   - Handle both string and list values for all link fields

6. **Implement `validate_frontmatter(meta: dict) → list[str]`**
   - Check required fields: `id` (non-empty string), `type` (valid enum value)
   - Check optional field types: `status` is valid enum, `covers`/`tags` are lists, link fields are strings or lists of strings
   - Return list of error messages (empty = valid)

7. **Define `FrontmatterError` exception class**

8. **Unit tests** — Cover:
   - Parse valid frontmatter with all fields
   - Parse with only required fields + defaults
   - Parse with custom/extra fields (preserved in output)
   - Parse file with no frontmatter → empty dict
   - Parse malformed YAML → FrontmatterError
   - Round-trip: serialize → parse produces identical dict + body
   - Update frontmatter preserves body exactly
   - Extract links from various field combinations
   - Validate: missing id, missing type, invalid type, invalid status

## Files to modify

- `backend/app/spec/frontmatter.py` — **NEW** — all functions above
- `backend/tests/spec/test_frontmatter.py` — **NEW** — unit tests

## Definition of done

- All functions implemented with type hints and docstrings
- Unit tests pass for all cases listed above
- Round-trip fidelity: `serialize(parse(text)) == text` for well-formed frontmatter
- No dependency on SQLite, registry, or service — pure parsing utilities
- `FrontmatterError` raised with clear messages for malformed input

## Style Notes

Follow conventions in `.claude/CLAUDE.md § Code Style — Python Backend`:
- `from __future__ import annotations` first, module docstring
- `@dataclass` or plain functions — no Pydantic needed (pure parsing, no serialization boundary)
- `FrontmatterError` as domain-specific exception
- Class-based tests: `class TestParseFrontmatter:`, `class TestSerializeFrontmatter:`, etc.
- Section separators: `# ── Parsing ──────`, `# ── Serialization ──────`

**Priority:** Critical — blocks all other frontmatter+SQLite tasks
**Depends on:** Nothing (leaf task)
**Started:** 2026-04-16
