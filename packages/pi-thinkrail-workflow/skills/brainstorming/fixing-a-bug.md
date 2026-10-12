# Fixing a bug — brainstorming's bug branch

Entry: a bug report, with the task-spec open (spine step 3). Saves: the task-spec's **Bug**
section. Next: spine step 8 (Build) — or spine step 5 when the "bug" turns out to be a feature.

A bug is a gap between what the product is meant to do and what it does. What it is meant to do
lives in the specs, so settle the spec side before touching the code.

1. **Pin the report.** Symptom (what happens), expected behavior (what should happen instead), and
   how to trigger it. Infer them from the request; ask only what is missing, in one round per the
   **asking-user-questions** concept skill.
2. **Reproduce** when a safe command can show it — a failing test is best. Never run a destructive
   command to reproduce. If it can't be reproduced, record that and carry on.
3. **Locate** the code that produces the behavior and the specs that govern that area (spec-graph).
4. **Classify** by what those specs say about the expected behavior:
   - **Silent** — no spec covers it. The intended behavior is a product decision: confirm it with
     the user as an inference, and step 9 adds it to the spec that should have stated it.
   - **Wrong** — a spec states the buggy or an outdated behavior. Confirm the correction with the
     user; step 9 fixes that spec.
   - **Right** — the spec already states the expected behavior; only the code is wrong. No question
     needed.
   - **Feature** — the code does what the specs intend, and the expected behavior was never
     intended. Tell the user it is a new capability and continue at spine step 5.
   Ask about the classification itself only when the evidence genuinely supports two of them.
5. **Record** symptom, expected behavior, reproduction (or "unreproduced"), classification, and the
   confirmed intended behavior in the task-spec's **Bug** section. The intended behavior is the
   accepted design — there is no separate design review for a bug.
6. **Fix it test-first** when practical: a regression test that fails before the fix and passes
   after. Continue at spine step 8.
