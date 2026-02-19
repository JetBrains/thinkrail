---
name: spec-review
description: Review and validate existing specifications against code. Use when the user wants to check if their specifications are accurate, complete, and follow best practices.
argument-hint: "[spec-path-or-directory]"
---

# Specification Review and Validation

You are helping the user **review and validate** their existing specifications. You will check for accuracy, completeness, consistency, and adherence to specification best practices.

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
- Does it link to its children?
- Are sibling references present for dependencies?

### Freshness
- Does the spec reflect the current state of the code?
- Are there TODO items in the spec that have been implemented?
- Are there documented features that no longer exist?

4. **Generate a review report** with:

```markdown
# Specification Review: {path}

## Summary
{Overall assessment: Good/Needs Work/Incomplete}

## Accuracy Issues
- {Issue}: {description and suggested fix}

## Completeness Gaps
- {Gap}: {what's missing and where it should be added}

## Structural Improvements
- {Improvement}: {what to change and why}

## Cross-Reference Issues
- {Issue}: {broken link or missing reference}

## Freshness Issues
- {Issue}: {outdated information}

## Recommendations
1. {Priority recommendation}
2. {Next recommendation}
```

5. **Offer to fix** any issues found, updating the specifications to match the code.

## Registry Integration

After reviewing, update `.specs/registry.json`:
1. Update the `status` of reviewed specs: `"active"` if accurate, `"stale"` if needs update
2. Update the `updated` timestamp for specs that were corrected

## After Completion

Use AskUserQuestion:

**What's next?**
- "Fix the issues found — update specs now (Recommended)"
- "/spec-lint — Run structural validation on other specs"
- "/spec-status — Full coverage dashboard"
- "Done for now"

## Key Principles

- **Code is truth**: When spec and code disagree, the code is correct
- **Be specific**: Point to exact lines, types, and files
- **Prioritize fixes**: Accuracy > Completeness > Structure > Style
- **Offer concrete fixes**: Don't just flag problems, suggest solutions
- **Update registry**: Always reflect review results in the registry
