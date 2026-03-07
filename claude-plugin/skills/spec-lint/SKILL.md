---
name: spec-lint
description: Validate specification structure, links, completeness, and consistency. Use to check that specs follow templates and are internally consistent.
argument-hint: "[spec-path-or-directory]"
---

# Specification Linter

You are validating specifications for **structural quality, completeness, and consistency**. This is the automated quality gate for spec-driven development.

## What You Check

### 1. Structural Completeness

Each spec type has required sections. Check they're present:

**architecture-design** (DESIGN_DOC.md):
- [ ] Table of Contents
- [ ] High-Level Pipeline diagram (ASCII art)
- [ ] Source Tree (annotated)
- [ ] Data Flow with concrete types
- [ ] Key Design Decisions (with rationale)
- [ ] Design Philosophy
- [ ] Sub-Module Documentation index table

**module-design** (module README.md):
- [ ] Module purpose (1-3 sentences opening)
- [ ] Table of Contents
- [ ] Pipeline/Architecture Overview diagram
- [ ] Public Interface with type signatures
- [ ] Output Contract table (Field | Type | Description)
- [ ] Internal Organization (file listing)
- [ ] Key Design Decisions (with rationale)
- [ ] Known Limitations
- [ ] File/Module Index table

**task-spec**:
- [ ] Title line (action verb + component)
- [ ] Context paragraph
- [ ] Technical details
- [ ] Files to modify (explicit paths)
- [ ] Definition of done / started date

**goal-and-requirements** (GOAL&REQUIREMENTS.md):
- [ ] Goal section with clear statement
- [ ] Description (1-2 paragraphs)
- [ ] Category field
- [ ] Priority field
- [ ] Business Requirements section with at least 2-3 entries (each with priority and rationale)
- [ ] Technical Requirements section with technology stack
- [ ] Technical Constraints section
- [ ] Non-Functional Requirements with at least 1-2 entries

### 2. Link Validation

Check all markdown links:
- `[text](path)` — does the target file exist?
- Cross-references between specs — are they reciprocal?
- Index tables in DESIGN_DOC.md — do all linked READMEs exist?

### 3. Registry Consistency

Compare `.specs/registry.json` against actual files:
- Every registry entry points to an existing file
- Every spec file on disk is registered
- Status fields are consistent (no "active" for clearly outdated specs)

### 4. Freshness Check

For each spec with a `covers` field:
- Compare spec modification time vs code modification time
- Flag specs that are older than their covered code

### 5. Content Quality

- Tables are properly formatted (headers, alignment)
- ASCII art diagrams are present where required
- Concrete types are used (not "returns the data" but "returns `Vec<Token>`")
- No TODO placeholders remaining in "active" specs (OK in "draft")
- No empty sections

### 6. Registry Format Validation

Validate `.specs/registry.json` entries against the backend schema:

**Spec entries:**
- Every entry has non-empty `id`, `type`, `path`, `title`
- `type` is one of: `goal-and-requirements`, `architecture-design`, `module-design`, `submodule-design`, `task-spec`
- `status` is one of: `draft`, `active`, `stale`, `deprecated`

**Links:**
- Every link's `type` is one of: `depends-on`, `parent`, `child`, `references`, `implements`
- No self-links (link `from` == `to`)
- Link source and target IDs both exist as spec entries in the registry

**Top-level fields:**
- Only recognized top-level keys: `version`, `project`, `specs`, `links`
- Flag any unrecognized top-level fields (e.g. `created`)

## Output Format

```markdown
# Spec Lint Report
Generated: {date}
Scanned: {N} specifications

## Results

### PASS (no issues)
- README.md — all sections present, links valid
- src/frontend/README.md — complete and consistent

### WARNINGS ({N})
- DESIGN_DOC.md:
  - Missing Design Philosophy section
  - Link to src/backend/README.md — file exists but not registered

### ERRORS ({N})
- src/parser/README.md:
  - Missing required section: Known Limitations
  - Missing required section: Output Contract table
  - Broken link: [sema/README.md](sema/README.md) — file not found

### STALE ({N})
- src/ir/README.md — spec modified 2026-01-15, code modified 2026-02-10

### UNREGISTERED ({N})
- current_tasks/fix_perf.txt — exists on disk but not in registry

## Summary
{N} specs checked: {P} pass, {W} warnings, {E} errors, {S} stale

## Auto-fix available
The following issues can be fixed automatically:
1. Register {N} unregistered specs
2. Fix {N} broken links (targets found at different paths)

Run with --fix to apply (or confirm to proceed).
```

## Process

### Step 1: Determine scope
- If path provided: lint only that spec
- If directory provided: lint all specs in that directory
- If nothing: lint the entire project

### Step 2: Read the registry

### Step 3: Scan all spec files

### Step 4: Run all checks per file

### Step 5: Generate report

### Step 6: Offer auto-fixes

For fixable issues, offer to:
- Register unregistered specs
- Update stale registry entries
- Fix simple broken links
- Remove unrecognized top-level fields from registry.json
- Remove self-links from registry.json
- Remove links referencing non-existent spec IDs

## After Completion

Use AskUserQuestion:

**What's next?**
- "/spec-review — Deep accuracy review of flagged specs (Recommended if errors found)"
- "/spec-next — See what to specify next"
- "/spec-status — Full coverage dashboard"
- "Done for now"

## Key Principles

- **Errors vs Warnings**: Missing required sections = ERROR. Missing optional sections = WARNING.
- **Auto-fix safely**: Only offer to fix things that are unambiguous (registry updates, not content)
- **Fast**: Structural checks only — don't deeply analyze content accuracy (that's `/spec-review`)
- **Actionable**: Every issue includes what to do about it
