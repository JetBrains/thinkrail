---
id: submodule-pi-todos-core
type: submodule-design
status: draft
title: pi-todos core (pi-free model)
parent: module-pi-todos
tags: [pi-extension, todos, v2]
---

## Responsibility

The pi-free TODO model: the `Todo` types (the status vocabulary) and `TodoStore` — a **per-session**
list stored as one file, `.thinkrail/context/todos/<sessionId>.json` (under the ephemeral context scratch
dir), read and written by read-modify-write. The
file is the source of truth; the store holds no mutable state, so every method re-reads and stale reads
are impossible (the agent's in-session writes and the UI's edits converge on the same file). Robust by
construction: a missing or corrupt file reads as an empty list, and unknown/invalid fields are dropped on
read (`sanitize`), so a hand-edited file never crashes a session.

**Artifacts.** An item may carry `artifacts` — links to what the work produced: `kind: "file" | "change" |
"spec" | "commit"`, an optional `label`, and per kind either a worktree-relative `path`
(`file`/`change`/`spec`, plus a durable graph `specId` for `spec`) or a `sha` (`commit`). The model just
stores them; it does not resolve paths, compute diffs, or touch git. `file`/`spec` are attached by the
agent (a `spec` naturally from `spec_create`'s `{path,id}`); `change` **and** `commit` are attached by the
host when an item reaches `done` — the host commits the item's work and records just the sha, or falls
back to a `change` path-list when it couldn't commit (see `server/src/todos` — the store stays git-free). `sanitize` drops an entry lacking its key (a `commit` with
no `sha`, any other kind with no `path`). The on-disk `version` is `6` (`3` added `artifacts`, `4` added
the `commit` kind, `5` added the `summary` fields, `6` added `commitSubject`); an older file reads cleanly
and is upgraded on the next write.

**Summaries (the review trail).** An item may carry `summary` — the agent's completion note (what/why,
the decisions the diff can't show, written as structured Markdown) — and **`verification`**, a separate
field for the exact check(s) run + result (or the honest "not verified"), kept apart from the prose so
the UI can badge it with a status glyph; both are **Markdown** (several checks read as a bullet list, not
one run-on line), and a missing verification line is visible at a glance; both set via `TodoPatch` when the item flips `done`; the plan itself may carry a
plan-level `summary` (`TodoFile.summary`, written by `TodoStore.setSummary`) — the overall handoff note
the agent writes when the whole plan completes; it is **cumulative** (everything done across the whole
plan, extended not rewritten when a prior note survives a re-completion — the tool layer echoes the
surviving text so the agent can build on it), never a recap of only the last step. Both are stored verbatim across later edits, with one
invalidation rule: `update` clears an item's own `summary`/`verification` the moment that item's `status`
leaves `done` — unless the same patch also supplies fresh values, which win. The **plan-level `summary`
survives a re-open** (it is NOT dropped with the item's fields): it stays stale so a reader can show it as
"Updating…" while the plan is being redone, and the next completion EXTENDS it rather than starting blank
(the cumulative contract). Gating a stale note out of a display or export is the reader's job.

**`commitSubject` (the git-facing title).** A third done-time field, same family and the same
invalidation rule: the subject line the host uses verbatim when it commits the item's delta (see
[[submodule-server-todos]]). It exists because `title` and a commit subject are **different texts for
different readers** — `title` is a plan step in the user's status panel ("Newest-first chat order"),
while the subject lands in the repository's permanent history next to human commits and must match that
history's own convention ("feat(web): add newest-first chat order"). Deriving one from the other is not
possible (the change's type/scope is knowable only from the change), so the agent authors both and the
store just carries them. The model stays git-free: it never validates the style, never reads `git log` —
the tool description and the todos skill carry the "match this repo's history" instruction, and the host
falls back to `title` when the field is absent. A reader gates the plan-level summary on "everything
done" (the UI shows it live, marked stale while re-opened; ungated consumers like a PR body / work report
render it only while every item is `done`), so a stale all-done story never leaks even though it survives
on disk. `replaceAll` deliberately does **not** carry the plan summary over — a fresh plan is new work. Review *state* is never stored here: it is user-owned and lives in a host sidecar
(see `server/src/todos`), so an agent re-plan can't flip a review decision.

**Group = task.** A group models one user ask; its items are the steps. A group's lifecycle is
**derived, never stored**: `groupStatus(group)` — all done → `done`, any in_progress → `active`, else
`pending` — so it can't drift from the steps. It has **one home**: the host reads it through this helper and
ships the result on the wire DTO (`TodoGroupItem.status`, see [[submodule-server-todos]]), so `apps/web` —
which may import `contracts` only — renders it rather than keeping a second copy of the truth table.

**`replaceAll` is an identity-preserving reconcile, not a replace.** `todo_write` sends a *desired*
plan; the model reaches for it to say "make the plan look like this, keep the progress", so
`replaceAll(plan)` reconciles rather than rebuilding from scratch:

- Each written grouped item is **matched** to an existing **agent** item by the key
  `(group title, item title)` — both compared *decoded and one-line-flattened* (see below); the first unconsumed match wins (duplicate
  titles reconcile positionally). A **match reuses the existing item**: its `id`, `createdAt`, `status`,
  `summary`, `verification`, `commitSubject`, and `artifacts` are kept; only `note` is updated from the
  write. A `status` in the write is **ignored for a matched item** — status advances only through
  `update`, so a re-listed `in_progress`/`done` step is never knocked back to `pending`. An **unmatched**
  written item is created fresh.
- **Leftovers** (existing items no written item matched): `origin: "user"` items are preserved into the
  loose lane; `done` items are preserved (rejoin a fresh group of the same title, else carried over under
  their original group, appended after the fresh groups); **agent + open** items are **dropped** — that is
  the legitimate "removed a step". A leftover **agent `done` item in the loose lane** (only reachable from a
  legacy/hand-edited file — no live path writes an agent loose item) is carried into a `"Completed"` group
  rather than left in the user's lane, so the loose-lane invariant below holds after every reconcile. Consequence: re-writing the same plan is a **no-op on progress** (no
  status reset, no duplicates, no orphaning).

**Loose lane = user-only** (held structurally): `TodoPlan.todos` (the lane the UI renders as "Other")
carries **only `origin: "user"` items** — agent-authored items always live in a group. `WritePlan` has
**no `todos` field** (`todo_write` reconciles `groups` only), so a write can never mint a loose agent item,
and `replaceAll` only ever admits `origin: "user"` items to `resultLoose` — a leftover agent `done` loose
item (a legacy stray) is carried into a `"Completed"` group, an open one dropped. The tools also refuse a
direct loose agent write (`todo_add` needs `group`/`after`). The invariant is robust by construction, not
dependent on the agent's tool discipline.

**Titles are one-line, normalized at the write boundary.** Item titles and group titles are the item
bullets and `##` group headings of the markdown export, which is a shipped artifact (the plan page's
export and the PR body). A newline — from the plan's multi-line add input or an agent escape — would
break that list, so `flattenTitle` collapses any whitespace run to a single space (forgiving, not a
reject) on every write path: `add`, `update`, `replaceAll` (including its reconcile key), and `sanitize`
on load. Callers and readers can assume a title never contains a newline; there is no per-render sanitize.

**Matching is title-based, by design's current increment.** Because the key is `(group title, item
title)`, a **group rename** or a **step rename** is not followed: the old item's done work is preserved
(carried under the old name), its open work is dropped, and the renamed item appears fresh. This is the
accepted cost of title matching; an optional per-item `id` in the `todo_write` schema is the planned next
increment that makes matching rename-proof.

**Linearity invariants** (held structurally): `update` setting `in_progress` auto-demotes every other
`in_progress` item back to `pending` in the same write and returns them (`TodoUpdateResult.paused`) so
the change stays visible; `replaceAll` re-establishes it over its **merged** result (fresh plan + the kept
user/done items), in display order — normalizing only the fresh half would leave a kept user item that is
`in_progress` beside a fresh `in_progress` step, i.e. two at once. `add`
takes `after` (an existing item id) to insert right after that item, **inheriting its lane** — the
surgical mid-plan insert (`after` wins over `group`; an unknown id throws).

## Public surface

The `index.ts` barrel:
- `TodoStore` (constructed per `(root, sessionId)`, incl. `setSummary` — the plan-level completion
  summary), `STORE_DIR` / `storeRel`, and the `countItems(plan)`
  + `flatItems(plan)` (every item in display order: groups first, the user's loose lane last — the one
  flatten reused by reads/updates/rendering) + `groupStatus(group)` helpers.
- The model types: `Todo`, `TodoGroup`, `TodoPlan`, `TodoFile`, `TodoInput`, `TodoPatch`,
  `TodoUpdateResult`, `WriteItem`, `WritePlan`, `TodoArtifact`, and the `TodoStatus` / `TodoOrigin` /
  `TodoGroupStatus` / `TodoArtifactKind` aliases.
- The `TODO_STATUSES` (`pending | in_progress | done`), `TODO_ORIGINS` (`agent | user`), and
  `TODO_GROUP_STATUSES` (`pending | active | done`, derived-only) tuples — the single source for the
  tools' param enums. (There is **no** priority concept; priorities were dropped.)

Writes are atomic (temp file + `rename`); a session id is validated as a safe path segment before it
becomes a filename, and `\uXXXX` escape-decoding is applied to **agent-authored** text only, never the
user's own input.

## Boundary

- **Allowed deps:** Node built-ins only (`node:fs`, `node:path`, `node:crypto`).
- **Forbidden:** any `@earendil-works/*` **and any `@thinkrail/*`** import — this is the pi-free,
  thinkrail-free layer the host can value-import without pulling pi into its bundle, and that stays
  installable under vanilla `pi`. Consequence: `STORE_DIR` (`.thinkrail/context/todos`) carries a **local
  mirror** of `@thinkrail/shared`'s `WORKSPACE_CONTEXT_DIR` rather than importing it — the shared constant
  is the host-side source of truth; keep the two in step. `tools/` imports this through the barrel;
  nothing here imports `tools/`.
