---
name: spec-review
description: Review and validate existing specifications against code. Use when the user wants to check if their specifications are accurate, complete, and follow best practices.
argument-hint: "[spec-path-or-directory]"
---

# Specification Review and Validation

You are helping the user **review and validate** their existing specifications. You will check for accuracy, completeness, consistency, and adherence to specification best practices.

## Quick Context

Before diving in, read `.specs/registry.json` for the list of specs and their metadata. Compare spec file mtimes against covered code mtimes to identify which specs are stale and need review most urgently.

## Your Process

1. **Read the specifications** at the path provided by the user (or the whole project if no path given).

2. **Read the corresponding source code** to validate accuracy.

3. **Check for these quality criteria**:

### Accuracy
- Do public interfaces match the actual code?
- Are type signatures correct?
- Do output contracts match what the code actually produces?
- Are file listings accurate (no missing or extra files)?

### Completeness
- Is every public type/function documented?
- Are all enum variants listed?
- Are all struct fields documented?
- Are design decisions explained with rationale?
- Are known limitations documented?

### Structural Quality
- Does it follow the appropriate template (overview, architecture, module, etc.)?
- Does it have a table of contents?
- Are there visual diagrams?
- Are concrete types used (not vague descriptions)?
- Are there file-to-purpose mapping tables?

### Cross-References
- Do all links work?
- Does it link to its parent document?
- Do its children have `parent` links back to it?
- Are sibling references present for dependencies?

### Freshness
- Does the spec reflect the current state of the code?
- Are there TODO items in the spec that have been implemented?
- Are there documented features that no longer exist?

4. **Present a short summary** of all conflicts found:

```markdown
# Specification Review: {path}

## Summary
{Overall assessment: Good/Needs Work/Incomplete}

Found **{N} issues** across the following categories:
- Accuracy: {count}
- Completeness: {count}
- Structural: {count}
- Cross-References: {count}
- Freshness: {count}

Resolving each issue one by one...
```

5. **Walk through each conflict one at a time**, in priority order (Accuracy > Completeness > Structure > Cross-References > Freshness):

For each issue:
- Describe the problem clearly: what the spec says vs what the code says (or what is missing/broken), with exact file paths and line references
- Then use **AskUserQuestion** to ask the user how to resolve it, with options like:
  - "Update spec to match code (Recommended)" — when code is the source of truth
  - "Update code to match spec" — when the spec captures intended design
  - "Skip / leave as-is" — defer this issue
  - (Add other context-appropriate options as needed)
- Apply the user's chosen resolution before moving to the next issue
- After resolving, briefly confirm what was changed, then move on to the next issue

Continue until all issues have been addressed.

6. **After all issues are resolved**, present a final summary:

```markdown
## Review Complete

- {X} issues fixed (spec updated)
- {Y} issues fixed (code updated)
- {Z} issues skipped
```

## Registry Integration

After reviewing, update `.specs/registry.json`:
1. Update the `status` of reviewed specs: `"active"` if all issues resolved, `"stale"` if any were skipped
2. Update the `updated` timestamp for specs that were corrected

## After Completion

Use AskUserQuestion:

**What's next?**
- "/spec-lint — Run structural validation on other specs (Recommended)"
- "/spec-status — Full coverage dashboard"
- "Done for now"

## Key Principles

- **Code is truth**: When spec and code disagree, the code is correct
- **Be specific**: Point to exact lines, types, and files
- **Prioritize fixes**: Accuracy > Completeness > Structure > Style
- **Offer concrete fixes**: Don't just flag problems, suggest solutions
- **Update registry**: Always reflect review results in the registry
