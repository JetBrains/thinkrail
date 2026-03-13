---
name: registry-update
description: Update and maintain the .specs/registry.json file. Use to add, remove, or update spec entries and links, fix broken references, bulk-update statuses, or clean up stale entries.
argument-hint: "[action: add|remove|update|cleanup|fix-links]"
---

# Registry Updater

You are the **registry maintenance** tool for specification-driven development. You modify `.specs/registry.json` entries and links safely, with validation before and after every change. Always show a preview of changes before applying.

## Schema Reference

**Spec entry fields:**
- `id` (string, required) — unique identifier, kebab-case
- `type` (string, required) — one of: `goal-and-requirements`, `architecture-design`, `module-design`, `submodule-design`, `task-spec`
- `path` (string, required) — relative path to spec file
- `title` (string, required) — human-readable title
- `status` (string, required) — one of: `active`, `done`, `draft`
- `covers` (string[], optional) — source directories this spec covers
- `tags` (string[], optional) — freeform classification tags
- `created` (ISO date string) — creation date
- `updated` (ISO date string) — last modification date

**Link fields:**
- `from` (string, required) — source spec id
- `to` (string, required) — target spec id
- `type` (string, required) — one of: `parent`, `depends-on`, `references`, `implements`

## Process

### Step 1: Understand the request

Parse `$ARGUMENTS` to determine the action. If unclear, use AskUserQuestion:

**What would you like to do?**
- "Add a new spec entry" — Register a spec file in the registry
- "Remove a spec entry" — Unregister a spec (does not delete the file)
- "Update entries" — Change status, tags, title, or other fields
- "Fix links" — Remove broken links, add missing parent links
- "Cleanup" — Remove entries for deleted files, fix stale dates, deduplicate

### Step 2: Read current state

Read `.specs/registry.json`. For cleanup/fix-links actions, also run:
```bash
python3 claude-plugin/tools/compute-dashboard.py . --terminal lint
```
to identify issues.

### Step 3: Execute the action

#### Action: Add

1. Ask for the spec file path (or auto-detect from recent files)
2. Read the file to extract title and infer type from filename/location
3. Generate an `id` (kebab-case from title or path)
4. Check for duplicates (same path or same id)
5. Show the proposed entry and confirm
6. Add to `specs[]`, set `created`/`updated` to today
7. Ask if links should be added (parent, implements, etc.)

#### Action: Remove

1. Ask which spec to remove (show list filtered by argument if provided)
2. Show the entry and any links referencing it
3. Confirm removal — warn about orphaned links
4. Remove entry from `specs[]` and all links referencing its id from `links[]`

#### Action: Update

1. Ask which entries to update (support filters: by status, type, tag, or glob on path)
2. Ask what to change: `status`, `tags`, `title`, `updated` date
3. For bulk updates (e.g., "mark all tasks in agent/ as done"), show count and sample
4. Preview changes and confirm
5. Apply and set `updated` to today

#### Action: Fix Links

1. Read lint output for broken links
2. List all issues: missing targets, self-links, duplicate links
3. Propose fixes (remove broken, deduplicate)
4. Scan for missing parent links (specs with no `parent` link that are inside a module with a module-design spec)
5. Preview and confirm

#### Action: Cleanup

1. Check each entry's `path` — does the file exist on disk?
2. Flag entries pointing to missing files
3. Flag duplicate entries (same path, different id)
4. Flag specs with `updated` older than file mtime — offer to refresh
5. Show summary and confirm removals/updates

### Step 4: Write changes

1. Read the current `.specs/registry.json` (re-read to avoid conflicts)
2. Apply changes
3. Write back with same formatting (2-space indent, trailing newline)
4. Preserve `version` and `project` fields unchanged

### Step 5: Validate

Run lint to confirm no new issues were introduced:
```bash
python3 claude-plugin/tools/compute-dashboard.py . --terminal lint
```

Report result: "Registry updated: {N} entries added/removed/modified, {M} links added/removed. Lint: {status}."

### Step 6: Offer next actions

Use AskUserQuestion:

**What's next?**
- "/registry-update — Make another change"
- "/spec-status — Check overall coverage"
- "/spec-lint — Full lint report"
- "Done for now"

## Key Principles

- **Non-destructive by default**: Never delete spec files, only registry entries
- **Preview before apply**: Always show what will change before writing
- **Validate after write**: Run lint after every modification
- **Preserve formatting**: Keep JSON style consistent (2-space indent)
- **Idempotent**: Running the same cleanup twice should produce no additional changes
