# Amending specs — brainstorming's shared tail

Entry: the accepted change is built and verified (spine step 8). Saves: the durable spec graph.
Ends: the workflow.

The specs stay the ground truth only if every change lands in them. This is your job, not a round
of approvals: do it yourself, and let the user see the result in the Changes review. Read the
**writing-specs** concept skill first — its bar holds for every edit here.

1. **Find what changed in the specs' terms** — from the task-spec and the actual diff, not the plan:
   - the goal doc, when a capability was added or removed or a principle overturned;
   - `architecture.md`, when topology, a cross-module decision, or a repo-wide invariant moved;
   - the owning module or submodule `SPEC.md`, for a responsibility, boundary, contract, decision,
     or known limitation — and a new spec for a genuinely new module;
   - for a bug classified silent or wrong, the spec that should have stated the intended behavior.
2. **Amend top-down** — goal → architecture → modules — without asking the user to approve the list
   or the edits. `spec_create` for a new spec, `spec_update` for frontmatter, `edit` for prose. Write
   the decisions and the *why* the code cannot show, once, in the spec that owns them; link the rest
   by `id`. Unconfirmed assumptions are marked unconfirmed where they stand.
3. **Check against reality.** Each amended spec matches what was built, not what was planned; the
   specs you touched don't contradict each other or use a term two ways. Run `spec_validate` and fix
   what it reports.
4. **Nothing durable changed?** (A bug classified right, a change the specs already describe.) Then
   make no edits — never invent content to show activity.
5. **Report in a line or two:** which specs changed, by name, and any unconfirmed assumption left in
   them. No per-file narration.
6. **Retire the task-spec** — delete it once its durable content is in the tree.

## Ending

This workflow ends here. PR lifecycle work, if requested, then enters **shipping-a-pr** separately.
