# challenging.md — reproduce, refute, look

Entry: the candidate list (`map.md` and `hunt.md`), `repo.md`. Saves `findings.md` and `repro/`.
Runs together with `assessing.md`; control goes next to `brief.md`.

## Why

Nothing reaches the brief unchallenged. Three moves, strongest first. Use every move that
applies; a candidate that only reading supports stays labelled `read`.

## A. Reproduce by running

**Where a browser or end-to-end harness exists**, one writing agent (and only one at a time)
drives the real product:

- Scratch spec files are new, untracked files in the harness's test folder, named
  `zz-review-<n>-<k>`, one test per candidate. When the agent finishes it moves them to
  `repro/` and removes any harness output it created.
- Each test asserts its preconditions first, performs the steps, then asserts **the defect's
  actual behavior**. A passing test means "reproduced".
- If a test does not pass, the agent finds out what really happens and reports
  `not reproduced` with the observed behavior. It never bends the test until it passes.
- A screenshot is taken at the telling moment into `repro/shots/<id>.png`.
- The agent gets the candidates in priority order and a time limit, and reports a table: id,
  verdict (`reproduced`, `not reproduced`, `could not set up`), what was observed, the test, the
  screenshot, and anything in a candidate's description that turned out inaccurate.

**For code with no screen**, a scratch unit or integration test against the real code, or a
small script, under `_work/repro/`.

**Where nothing can be run**, say so under "Not examined"; those candidates go to the skeptic.

## B. Refute

One reviewing agent takes the candidates that were reasoned from code or shown only at unit
level. For each it tries to show the candidate is false, harmless or already handled:

- a guard, an ordering guarantee, or a reason it cannot be reached through the shipped product;
- the same behavior at the base, which makes it pre-existing;
- for a race, **the size of the window, measured or traced**, and whether a person or a held key
  can fit inside it.

Verdict per candidate: `confirmed` (the failing path traced or run end to end), `refuted` (the
guard named), `pre-existing` (shown at the base), or `unsettled` (with the exact run that would
settle it). Severity on a fixed scale:

| Severity | Meaning |
|---|---|
| `blocker` | A confirmed defect a normal user can hit that silently loses or corrupts data or a setting, or breaks a headline promise of the PR |
| `should-fix` | A confirmed defect with a limited or recoverable effect |
| `minor` | Cosmetic, rare, or needing unusual conditions |
| `not-a-defect` | Specified, intended, or unchanged by the PR |

The agent ends by listing where its verdict contradicts an earlier pass.

## C. Look

Code readers do not see what is on the screen. Where the product has one:

- **Sweep.** A scratch spec opens every screen the PR touches, in each main state, and saves
  screenshots to `repro/sweep/`. It also scans visible text and accessible labels for literal
  placeholders, raw translation keys, `undefined`, `null`, `NaN` and `[object Object]`.
- **Look at every screenshot.** The agent opens each image and lists concrete anomalies it can
  point at: a literal placeholder, clipped or overlapping text, a control out of line with its
  row, an empty area where content is missing, wording that does not match its control. It
  writes "nothing notable" for a screen that looks right, and reports no design preferences.
- **Text checks by script**, when the measuring stage did not already run them.

## Write `findings.md`

Numbered `A1…`, one row each:

- what a user sees, in one or two sentences;
- how it was established: `browser`, `run`, `test` or `read`;
- `path:line`;
- a label from the user's policy. The default policy: a confirmed defect or data risk, and weak
  tests on risky logic, are **Fix before merge**; a spec or boundary violation is **Warn**;
  needless complexity or debt is **Debt**, prominent and not blocking. Within defects, use
  **Fix before merge**, **Should fix** and **Minor** from the severity scale.

Then **Dropped by the challenge stage**: each dropped candidate with the reason. This list goes
into the brief; it shows the filter works.

Record in `log.md` what this stage corrected in the map and the hunt.

## Next

When `assessing.md` is done too, read and follow `brief.md`.
