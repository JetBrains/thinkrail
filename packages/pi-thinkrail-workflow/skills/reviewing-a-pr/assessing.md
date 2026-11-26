# assessing.md — tests, size, the next change, spec fit

Entry: `map.md`, `evidence.md`, `repo.md`. Saves `assessment.md`. Runs together with
`challenging.md`; control goes next to `brief.md`.

## Why

Four measurements answer what a defect hunt cannot: would the tests notice a break, is the PR
larger than its feature needs, what will the next change cost, and does the code match its
specs. Each is a separate agent. The first and third edit code, so they work in a private copy.

## Private copy

```
mkdir -p .thinkrail/context/review-<n>/_work/<name> && cd there
git -C <repo> archive HEAD | tar -x -C .
<install dependencies inside the copy>
```

Never a git worktree. The agent ends by confirming the real repository is untouched and that no
mutation is left in the copy's sources.

## 1. Test strength: break the code and see

One writing agent, in a private copy.

- Record the baseline first: the unit test commands, pass counts and times, and any test that
  fails before anything is changed.
- Choose 20 to 40 probes on **the risky logic the PR adds**, taken from the map's hot spots and
  grouped by the risk they stand for. Each probe is one small change of behavior that still
  compiles and runs.
- For each: apply it, run the smallest tests that should notice, record `killed by <test>` or
  `survived`, revert, and check the file is back.
- Never weaken a test. Never leave a mutation in place.
- Classify every survivor: not a real gap (an equivalent change, or an artifact of the probe);
  a unit gap likely covered by a higher-level test (cite it; do not run it); or **no test of any
  kind**.
- Report a table per group, killed against survived, and the list with no test of any kind.

The finding that matters is where the gap sits. A gap in the same code where defects were found
is "weak tests on risky logic".

## 2. Size: a subtraction pass

One read-only agent. Opinions do not help; costed removals do.

- For each removal it stands behind: what to delete or collapse; the evidence, counted; the net
  line change; what protection would be lost; the risk; and when (`before merge`, `after merge`,
  `leave`).
- It says "leave" where the PR's choice is the smaller or safer one.
- It answers three questions with numbers: how much of the net growth is essential to the
  promised behavior and how much is avoidable; whether the PR removed more special cases than it
  added (checking each such claim in the description against the base); and which three removals
  most reduce **what a future developer must know**.

## 3. The next change: do it for real

One writing agent, in a second private copy.

- Pick the most likely next change that must follow the PR's new pattern: one more of whatever
  the PR generalizes.
- **Task A.** Make the change completely. Record every file touched, in order, and how the agent
  knew it was needed: a type error, a failing test, a failing check, a sentence in a spec, or
  only by reading a sibling. Record how long finding the steps took against making the edit, and
  whether any single document lists the steps. Run the repository's gates on the result.
- **Task B, the omission matrix.** From the complete change, undo one step at a time and rerun
  the gates. For each: what caught it, how clearly, and what a user would experience if nothing
  did.
- Try the cheapest guard that would close the largest gap, then revert it.
- End with three sentences: what the pattern enforces mechanically, what it leaves to memory,
  and the cheapest guard.

A static count of files is an estimate. The dry run is the measurement.

## 4. Spec and boundary fit

From the map and the specs the PR touched, list:

- statements in specs or docs that the code contradicts, with both sides cited;
- rules the PR itself wrote down and then broke;
- module boundary breaks, and whether any script enforces the boundary;
- docs that still describe the old behavior.

These are warnings, not blockers, unless the user's policy says otherwise.

## Write `assessment.md`

Four short sections with their tables. For the brief's cost table, carry: the removable share of
net source lines, files touched by the real next change, omissions caught by nothing out of the
number tried, and the count of call-site conventions nothing enforces.

## Next

When `challenging.md` is done too, read and follow `brief.md`.
