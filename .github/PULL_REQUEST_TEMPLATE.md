## Problem

What problem does this PR solve? Describe the user or developer impact and why the change is needed.

## Approach

How does the solution address the problem? Explain the important decisions and trade-offs at reviewer level; avoid a file-by-file implementation transcript.

## Changes

List the concrete behavior, contract, or module changes reviewers should inspect.

## Screenshots

Required for frontend changes: include before/after screenshots of the same scenario and viewport. Otherwise write `Not applicable — no frontend changes.`

## Related issues

Closes #...

## Checklist

- [ ] Fast gates pass: `bun run lint`, `bun run typecheck`, `bun run test`
- [ ] E2E suite passes for app-affecting changes (`bun run e2e`, or `bun run e2e:full` when touching agent behavior)
- [ ] Before/after screenshots are included for frontend changes, or marked not applicable
- [ ] Relevant `SPEC.md` / top-level specs updated to reflect any boundary, contract, or behavior change
- [ ] I have read the [Contributing guide](../CONTRIBUTING.md) and agree to the [Code of Conduct](../CODE_OF_CONDUCT.md)
