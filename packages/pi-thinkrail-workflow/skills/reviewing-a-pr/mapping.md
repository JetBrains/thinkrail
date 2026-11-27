# mapping.md — what changed, per group, to a template

Entry: `groups.md`, `pr-body.md`, `repo.md`. Saves `map.md`. Runs together with `measuring.md`;
control goes next to `hunting.md`.

## Why

A map finds what a defect hunt does not: claims that do not hold, behavior removed without
mention, and the judgment calls. It is comprehension and judgment, not bug hunting, and
everything it reports is `read` and still a candidate.

## Delegate

One read-only agent per change group, all started in one message. Write the template below to
`_work/map-brief.md` once; each task names the group, lists its files, and adds two to five
pointed questions about that group's risk marks.

For a group of many similar files, tell the agent to describe the common recipe once, with one
file as the worked example, then list only what deviates per file.

## Template for a code group

The agent returns exactly these sections, about 1,100 words at most, not counting excerpts:

1. **Purpose.** Three sentences at most, in plain words.
2. **How it works.** Ten bullets at most: the main data shapes, the one or two most important
   paths traced end to end with `path:line`, and where state lives.
3. **New concepts.** Every new named abstraction or rule a future developer must learn, one line
   each with `path:line`, and the count.
4. **Design decisions.** Three to six choices that shape this part. For each: the choice, **the
   alternative not taken** (an existing pattern it could have reused, or a simpler approach), and
   a one-line view on whether the code justifies the choice.
5. **Claims check.** Each claim in the description that concerns this part: `confirmed`,
   `not as described`, or `could not verify`, with evidence. Then **Undisclosed**: changes the
   description does not mention, behavior removed or changed first.
6. **Risk hot spots.** Up to six places where a defect would be most expensive or most likely.
   Anything that looks actually wrong goes under **Looks wrong** with a concrete scenario.
7. **Complexity smells.** Concrete: oversized functions, duplicated logic (inside the part, or
   duplicating something the repository already has: search before claiming), single-use
   abstractions, parallel implementations, workarounds, code that exists only for tests.
8. **Human eyes.** One to three excerpts of 25 lines at most, quoted with `path:line`: the core
   of the mechanism or the riskiest trick, each with one line on what to judge.
9. **Future change.** One likely next change to this part: the files to touch after this PR and,
   from the base, how many before.

Rules in the brief: read-only, no tests or builds; every statement carries `path:line`; no
praise; say what was not read.

## Template for a group of changed tests

A reviewer needs to know whether existing tests were bent to fit the new code. The agent reads
every changed test file's diff and returns:

1. **New coverage**: scenarios per new file, and what the description promises that no test
   covers (checking lower-level tests before calling something uncovered).
2. **Helpers**: what shared helpers do, and whether they hide waits, retries or early returns
   that could mask a failure.
3. **Modified tests**: one row per file with a class: `selectors` (only locators changed),
   `flow` (the steps changed, assertions equivalent), `weakened`, `removed`, `added`. For every
   `weakened` or `removed`: the old assertion quoted, what replaced it, and whether the behavior
   it protected still exists.
4. **Flake risks**: fixed waits, raised timeouts, one-shot reads.
5. Counts per class, and the three changes a person should look at.

## Synthesize `map.md`

Do not paste reports. Write, from all of them:

- **What the PR is**: five bullets at most.
- **Change groups**: the table.
- **How it works**: six sentences at most.
- **Decisions worth judgment**: choice, alternative, the mapper's view.
- **Claims that do not hold**, and **changes the description does not mention**.
- **Candidates** for the challenge stage, numbered `C01…`, each one line with its files.
- **Complexity and debt signals**, and the **future-change** table.
- **Code a person should read**: paths and line ranges, about 200 lines in total.

The candidate list is also the "already filed" list that hunters receive.

## Next

When `measuring.md` is done too, read and follow `hunting.md`.
