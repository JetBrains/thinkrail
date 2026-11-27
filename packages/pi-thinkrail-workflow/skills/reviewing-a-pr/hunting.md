# hunting.md — an independent defect hunt, per slice

Entry: `map.md` with its candidate list, `repo.md`. Saves `hunt.md`. Control goes next to
`challenging.md` and `assessing.md`, run together.

## Why

The hunt is full and independent of any review already on the PR. It is sliced by risk, each
hunter is told what is already filed so it looks elsewhere, and each may prove a defect with a
scratch test.

## Slices

Slice by where a defect would cost most, not into equal parts. Typical slices: the server and
wire side; each engine or state machine the PR adds; the frame that wires things together; then
the rewritten areas in two to four slices. One reviewing agent per slice, all started in one
message.

## The hunter's brief

Write this once to `_work/hunt-brief.md`; each task names the slice, its files, what is already
filed for it, and five to ten pointed things to look at.

**Ground rules.** Tracked files and git state are not changed. A single test file may be run when
it settles a question. Builds, lint, type checks and end-to-end runs are not run: CI did, and
another agent may be using the harness. A scratch test that proves a defect may be created under
`_work/repro/<slice>/` and nowhere else. Report only what this PR introduced or made worse.

**What to hunt, in this order.**

1. **State lifecycle.** Every piece of state the change introduces (pending and optimistic
   values, queues, latches, caches, timers, listeners): where it is set, where it is cleared, and
   what clears it on every exit path, including failure, teardown and a second action before the
   first settles.
2. **Ordering.** A reply or echo against local state, queued writes, sequence counters, stale
   closures, a move racing a re-render.
3. **Input and focus edges.** A key or event handled twice or not at all, focus lost when a
   control disables or disappears, navigation keys inside text fields, composition input.
4. **Data loss and destructive actions.** A write caused by navigation, a missing confirmation,
   reset semantics, files written on disk, concurrent edits.
5. **Compatibility and error paths.** An older peer on a changed protocol, invalid input, a
   rejection nobody handles, partial failure.
6. **Behavior silently removed** against the base: a validation, an error state, a guard
   against a double submit.
7. Anything else that is concretely wrong.

**Not wanted:** style, naming, "could be cleaner", missing tests on their own, speculative
hardening, problems that existed before the PR.

**Report format.** For each finding: a title; severity (`BUG`, wrong behavior a user can hit, or
`RISK`, plausible under specific conditions); where; a numbered scenario with expected against
actual; the mechanism with `path:line` per hop; the evidence (what was run, or "reasoned from
code"); confidence and what would raise it; a fix in one or two lines. Eight findings at most.

Then two sections that matter as much as the findings:

- **Checked and clean**: five to ten specific worries investigated and found handled, each with
  the `path:line` of the guard. It is the only record of what was examined.
- **Not examined**: what the hunter did not get to.

An already-filed item is not reported again. The hunter does say when it is worse, narrower or
wrong.

## Condense into `hunt.md`

As each report arrives, write per slice: the findings with their evidence level, the corrections
to the map, and the checked-and-clean list in one paragraph.

Then, across slices:

- **Name the class.** When two slices report the same root cause from different files, write it
  once as a class with its instances. A per-slice hunt reports instances; nobody else will name
  the class.
- A slice that returns no findings and ten checked items is a result. Keep it for the brief's
  trust section.
- Add every new finding to the candidate list for the challenge stage.

## Next

Read and follow `challenging.md` and `assessing.md`; their agents start together.
