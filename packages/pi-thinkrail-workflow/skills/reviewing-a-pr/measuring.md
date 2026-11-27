# measuring.md — before and after, by script

Entry: `pr.md` with the head SHA and merge base, `repo.md`. Saves `evidence.md` (300 lines at
most) and `evidence.json`, with the script under `_work/`. Runs together with `mapping.md`; control
goes next to `hunting.md` when both are done.

## Why

Size, complexity and test changes are measured, not judged. One agent writes a script that can be
rerun in seconds; later stages and the brief quote its numbers.

## Delegate

One writing agent, with a brief file. It may write only under
`.thinkrail/context/review-<n>/`. For whole-tree comparisons it extracts the base once:
`git archive <merge-base> | tar -x -C _work/base`.

Tell it which parser the repository already has installed. If the language's compiler offers no
scripting API, use a parser from the installed dependencies or careful text matching, and say
which was used for each metric.

## Metrics

Adapt the names to the repository's language; keep the questions.

1. **Size.** Files, additions and deletions by kind (source, unit tests, end-to-end tests, docs
   and specs, translations, other) and by top-level area. Net source lines.
2. **Escape hatches.** Counted on added and on removed lines separately, source and tests
   separately: lint and type suppressions, unchecked casts, `TODO`/`FIXME`/`HACK`, timers and
   deferred callbacks, debug printing. Every added occurrence with `path:line`.
3. **Tests.** Test files deleted; test names present at the base and absent at the head, per
   file; files where the assertion count fell; added skips; raised timeouts; fixed waits.
4. **Public surface.** Exported names added and removed in each module's public entry file. Any
   change to a wire protocol, a schema, a migration or a version constant, with the diff lines.
5. **Module edges.** Imports between top-level modules at base and head: edges added, removed,
   and counts that moved by five or more. For a new module: who imports it, what it imports.
6. **Outliers.** For changed and added source files, per function: length, branching, nesting.
   The 25 longest and the 25 most branching at the head, each marked new, changed (with the base
   value) or unchanged. File growth for the 25 largest files.
7. **State and DOM use**, for UI code: counts at base and head of the framework's state and
   effect hooks, event listeners, direct DOM queries and focus calls. Totals and the top files.
8. **Duplication.** If a detector runs without setup trouble, duplicated share and clone count at
   base and head. If it cannot run in about five minutes, say so and skip.
9. **Dead surface.** New exported names that nothing imports, and those only tests import.
10. **Text.** Where translation files exist: keys added and removed; calls whose passed values
    do not match the placeholders in the source-language string, at base and at head.
11. **Comments**, when the repository has a rule about them: added and removed comment lines.

## Rules for the agent

- Facts only: no interpretation and no advice.
- **Sanity anchors:** totals must equal `git diff --shortstat <merge-base> HEAD`. If they do not,
  the script is wrong.
- Spot-check at least five reported items by opening the file at the line; say which.
- A metric that cannot be computed is reported as such with the reason. Never fill a gap with an
  estimate.
- `evidence.md` opens with **Outliers**: the twelve most notable measured facts, one line each
  with `path:line`.
- The final report names the output paths, quotes the Outliers, and lists what was not computed.

## What to carry forward

From the Outliers, note for the brief's cost table: net source lines, the largest new function,
escape hatches added, test names gone, new exports nothing imports. The assessment stage adds the
rest.

## Next

When `mapping.md` is done too, read and follow `hunting.md`.
